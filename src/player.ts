import { synth } from "./audio";
import type { Song } from "./songs";

// A lookahead scheduler against the Web Audio clock (ctx.currentTime), not
// setTimeout: setTimeout drifts under load, and the Web Audio clock is the
// same clock pluck() schedules against, so live playing and song playback
// never fall out of sync with each other.
const LOOKAHEAD_MS = 100;
const SCHEDULE_AHEAD_S = 0.25;

export type PlayerState = "stopped" | "playing" | "paused";

export class SongPlayer {
  private song: Song | null = null;
  private state: PlayerState = "stopped";
  private nextNoteIndex = 0;
  private songStartCtxTime = 0;
  private pausedAt = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private onProgress: (elapsed: number, duration: number, state: PlayerState) => void = () => {};

  get currentState(): PlayerState {
    return this.state;
  }

  onProgressChange(cb: (elapsed: number, duration: number, state: PlayerState) => void): void {
    this.onProgress = cb;
  }

  private get duration(): number {
    if (!this.song || this.song.notes.length === 0) return 0;
    const last = this.song.notes[this.song.notes.length - 1];
    return last.startTime + last.duration;
  }

  load(song: Song): void {
    this.stop();
    this.song = song;
  }

  play(): void {
    const ctx = synth.ensureStarted();
    if (!this.song) return;
    if (this.state === "playing") return;

    if (this.state === "stopped") {
      this.nextNoteIndex = 0;
      this.pausedAt = 0;
    }
    this.songStartCtxTime = ctx.currentTime - this.pausedAt;
    this.state = "playing";
    this.tick();
    this.timer = setInterval(() => this.tick(), LOOKAHEAD_MS);
  }

  pause(): void {
    if (this.state !== "playing" || !synth.context) return;
    this.pausedAt = synth.context.currentTime - this.songStartCtxTime;
    this.state = "paused";
    this.stopTimer();
    this.report();
  }

  stop(): void {
    this.state = "stopped";
    this.nextNoteIndex = 0;
    this.pausedAt = 0;
    this.stopTimer();
    this.report();
  }

  restart(): void {
    this.stop();
    this.play();
  }

  private stopTimer(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private tick(): void {
    const ctx = synth.context;
    if (!ctx || !this.song || this.state !== "playing") return;

    while (this.nextNoteIndex < this.song.notes.length) {
      const note = this.song.notes[this.nextNoteIndex];
      const when = this.songStartCtxTime + note.startTime;
      if (when > ctx.currentTime + SCHEDULE_AHEAD_S) break;
      synth.pluck({
        stringId: note.stringId,
        intensity: note.intensity,
        when,
        source: "song",
        pluckPosition: 0.5,
      });
      this.nextNoteIndex++;
    }

    if (this.nextNoteIndex >= this.song.notes.length) {
      const elapsed = ctx.currentTime - this.songStartCtxTime;
      if (elapsed > this.duration + 0.3) {
        this.stop();
        return;
      }
    }
    this.report();
  }

  private report(): void {
    const ctx = synth.context;
    const elapsed =
      this.state === "playing" && ctx ? ctx.currentTime - this.songStartCtxTime : this.pausedAt;
    this.onProgress(Math.min(elapsed, this.duration), this.duration, this.state);
  }
}
