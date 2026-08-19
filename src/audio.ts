import { STRINGS_BY_ID } from "./strings";

export type PluckSource = "pointer" | "touch" | "keyboard" | "song";

export interface PluckEventDetail {
  stringId: string;
  intensity: number;
  when: number;
  source: PluckSource;
  /** 0 (near the neck) .. 1 (near the soundbox), where the string was excited. */
  pluckPosition: number;
}

// Every input path — click, drag, touch, keyboard, demo-song playback —
// funnels through this one function, so "who made the sound" never forks
// into separate logic paths that could drift apart.
export const PLUCK_EVENT = "instrument:play";

interface Voice {
  stop(atTime: number): void;
}

const MAX_VOICES = 24;

class HarpSynth {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private reverbSend: GainNode | null = null;
  private convolver: ConvolverNode | null = null;
  private voices: Voice[] = [];
  private stringVoices = new Map<string, Voice[]>();
  private muted = false;

  /** Must be called from a user gesture handler (click/keydown/touchstart). */
  ensureStarted(): AudioContext {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return this.ctx;
    }
    const AudioContextCtor =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioContextCtor();
    this.ctx = ctx;

    const master = ctx.createGain();
    master.gain.value = 0.8;

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 24;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.2;

    const convolver = ctx.createConvolver();
    convolver.buffer = buildImpulseResponse(ctx);
    const reverbSend = ctx.createGain();
    reverbSend.gain.value = 0.16;

    master.connect(compressor);
    compressor.connect(ctx.destination);
    reverbSend.connect(convolver);
    convolver.connect(compressor);

    this.master = master;
    this.compressor = compressor;
    this.convolver = convolver;
    this.reverbSend = reverbSend;
    return ctx;
  }

  get context(): AudioContext | null {
    return this.ctx;
  }

  setVolume(value: number): void {
    if (this.master) this.master.gain.value = value;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  /** The one entry point every input path calls. */
  pluck(detail: PluckEventDetail): void {
    if (this.muted) return;
    const string = STRINGS_BY_ID.get(detail.stringId);
    if (!string || !this.ctx || !this.master || !this.reverbSend) return;

    this.stealVoiceIfFull();

    const ctx = this.ctx;
    const startAt = Math.max(detail.when, ctx.currentTime);
    const intensity = Math.min(1, Math.max(0.05, detail.intensity));
    // Near the neck (pluckPosition near 0) is brighter; near the soundbox
    // (near 1) is warmer — a rough stand-in for real pluck-position timbre.
    const brightness = 1 - detail.pluckPosition * 0.5;

    const gain = ctx.createGain();
    const peak = 0.22 + intensity * 0.35;
    gain.gain.setValueAtTime(0, startAt);
    gain.gain.linearRampToValueAtTime(peak, startAt + 0.004);
    const decay = 1.6 + (1 - detail.pluckPosition) * 1.2;
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + decay);

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = string.frequency * (2.5 + brightness * 3);
    filter.Q.value = 0.6;

    const dry = ctx.createGain();
    dry.gain.value = 0.9;

    gain.connect(filter);
    filter.connect(dry);
    dry.connect(this.master);
    filter.connect(this.reverbSend);

    const oscillators: OscillatorNode[] = [];
    const partials: Array<[number, number, OscillatorType]> = [
      [1, 1, "triangle"],
      [2, 0.35, "sine"],
      [3, 0.15 * brightness, "sine"],
      [4, 0.06 * brightness, "sine"],
    ];
    for (const [multiple, amplitude, type] of partials) {
      if (amplitude <= 0) continue;
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = string.frequency * multiple;
      const partialGain = ctx.createGain();
      partialGain.gain.value = amplitude;
      osc.connect(partialGain);
      partialGain.connect(gain);
      osc.start(startAt);
      osc.stop(startAt + decay + 0.05);
      oscillators.push(osc);
    }

    // A short burst of filtered noise gives the pluck its transient "pick"
    // instead of every note fading in like a synth pad.
    const noise = ctx.createBufferSource();
    noise.buffer = pluckNoiseBuffer(ctx);
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.value = string.frequency * 2;
    noiseFilter.Q.value = 1.2;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(intensity * 0.18, startAt);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.06);
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(gain);
    noise.start(startAt);
    noise.stop(startAt + 0.08);

    const cleanup = () => {
      for (const osc of oscillators) osc.disconnect();
      noise.disconnect();
      noiseFilter.disconnect();
      noiseGain.disconnect();
      gain.disconnect();
      filter.disconnect();
      dry.disconnect();
      this.voices = this.voices.filter((v) => v !== voice);
      const forString = this.stringVoices.get(detail.stringId);
      if (forString) this.stringVoices.set(detail.stringId, forString.filter((v) => v !== voice));
    };
    oscillators[0]?.addEventListener("ended", cleanup, { once: true });

    const voice: Voice = {
      stop(atTime: number) {
        gain.gain.cancelScheduledValues(atTime);
        gain.gain.setValueAtTime(gain.gain.value, atTime);
        gain.gain.linearRampToValueAtTime(0.0001, atTime + 0.08);
        for (const osc of oscillators) {
          try {
            osc.stop(atTime + 0.09);
          } catch {
            // already scheduled to stop
          }
        }
      },
    };
    this.voices.push(voice);
    const forString = this.stringVoices.get(detail.stringId) ?? [];
    forString.push(voice);
    this.stringVoices.set(detail.stringId, forString);

    document.dispatchEvent(new CustomEvent<PluckEventDetail>(PLUCK_EVENT, { detail, bubbles: true }));
  }

  /** Space bar / the "damp all" control: stop every ringing string quickly. */
  dampAll(): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const voice of this.voices) voice.stop(now);
  }

  private stealVoiceIfFull(): void {
    while (this.voices.length >= MAX_VOICES) {
      const oldest = this.voices.shift();
      if (oldest && this.ctx) oldest.stop(this.ctx.currentTime);
      else break;
    }
  }
}

function pluckNoiseBuffer(ctx: AudioContext): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * 0.08);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function buildImpulseResponse(ctx: AudioContext): AudioBuffer {
  const duration = 1.4;
  const length = Math.floor(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      const decay = Math.pow(1 - i / length, 2.2);
      data[i] = (Math.random() * 2 - 1) * decay;
    }
  }
  return buffer;
}

export const synth = new HarpSynth();
