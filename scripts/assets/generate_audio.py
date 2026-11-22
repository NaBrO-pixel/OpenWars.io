#!/usr/bin/env python3
"""Generates OpenWars' original music and sound effects.

Everything here is synthesized from code (additive tones, shaped noise),
with no samples or recordings, so the audio is original to this repository
and replaces the proprietary OpenFront tracks (proprietary/sounds). Output
is deterministic: the same script always writes the same audio.

    python3 scripts/assets/generate_audio.py

Writes MP3s (via ffmpeg + libmp3lame) to resources/sounds/:
    music/openwars-menu.mp3          menu theme
    music/openwars-gameplay-1.mp3    martial march
    music/openwars-gameplay-2.mp3    tense, pulsing
    music/openwars-gameplay-3.mp3    driving
    effects/openwars-game-start.mp3  "your game is starting" chime

Needs Python 3 with numpy, and ffmpeg on PATH.
"""

import os
import subprocess
import sys
import tempfile
import wave

import numpy as np

SR = 44100
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "resources", "sounds")

MINOR = [0, 2, 3, 5, 7, 8, 10]
MAJOR = [0, 2, 4, 5, 7, 9, 11]


def hz(midi):
    return 440.0 * 2.0 ** ((midi - 69) / 12.0)


def env(n, attack, release, sustain=1.0, decay=0.0):
    """Attack/decay/sustain/release envelope over n samples (times in s)."""
    t = np.arange(n) / SR
    e = np.ones(n) * sustain
    a = max(attack, 1e-4)
    e = np.where(t < a, t / a, e)
    if decay > 0:
        d = (t >= a) & (t < a + decay)
        e[d] = 1 - (1 - sustain) * (t[d] - a) / decay
    r = max(release, 1e-4)
    tail = t > (n / SR - r)
    e[tail] *= np.clip((n / SR - t[tail]) / r, 0, 1)
    return e


def tone(freq, dur, harmonics, detune_cents=0.0, vibrato=0.0, phase=0.0):
    """Additive tone: harmonics is [(multiple, amplitude, decay_per_s)]."""
    n = int(dur * SR)
    t = np.arange(n) / SR
    f = freq * 2.0 ** (detune_cents / 1200.0)
    if vibrato:
        lfo = 1 + vibrato * np.sin(2 * np.pi * 5.2 * t) * np.clip(t / 0.4, 0, 1)
        ph = 2 * np.pi * np.cumsum(f * lfo) / SR
    else:
        ph = 2 * np.pi * f * t
    out = np.zeros(n)
    for mult, amp, dec in harmonics:
        if f * mult > SR / 2.2:
            continue
        out += amp * np.sin(mult * ph + phase * mult) * np.exp(-dec * t)
    return out


class Mix:
    def __init__(self, seconds):
        self.n = int(seconds * SR) + SR * 4
        self.left = np.zeros(self.n)
        self.right = np.zeros(self.n)

    def add(self, sig, at, gain=1.0, pan=0.0):
        i = int(at * SR)
        if i >= self.n:
            return
        sig = sig[: self.n - i]
        lg = gain * np.sqrt((1 - pan) / 2)
        rg = gain * np.sqrt((1 + pan) / 2)
        self.left[i : i + len(sig)] += sig * lg
        self.right[i : i + len(sig)] += sig * rg

    def echo(self, delay, feedback, mix, taps=5):
        d = int(delay * SR)
        for ch in (self.left, self.right):
            wet = np.zeros_like(ch)
            for k in range(1, taps + 1):
                if d * k >= len(ch):
                    break
                wet[d * k :] += ch[: -d * k] * feedback**k
            ch += wet * mix
        # A little cross-feed so the echo spreads across the stereo field.
        l, r = self.left.copy(), self.right.copy()
        self.left += 0.12 * np.roll(r, d // 2)
        self.right += 0.12 * np.roll(l, d // 2)

    def master(self, seconds, fade_in=1.5, fade_out=4.0, peak=0.89):
        n = int(seconds * SR)
        st = np.stack([self.left[:n], self.right[:n]])
        st = np.tanh(1.3 * st / (np.max(np.abs(st)) + 1e-9)) / np.tanh(1.3)
        st *= peak
        fi, fo = int(fade_in * SR), int(fade_out * SR)
        st[:, :fi] *= np.linspace(0, 1, fi)
        st[:, -fo:] *= np.linspace(1, 0, fo)
        return st


# --------------------------------------------------------------------------
# Instruments
# --------------------------------------------------------------------------

PAD = [(1, 1.0, 0), (2, 0.5, 0), (3, 0.28, 0), (4, 0.16, 0), (5, 0.1, 0), (6, 0.06, 0)]
BASS = [(1, 1.0, 1.2), (2, 0.45, 2.5), (3, 0.15, 4)]
PLUCK = [(1, 1.0, 5), (2, 0.6, 8), (3, 0.35, 11), (4, 0.2, 14), (5, 0.12, 18)]
HORN = [(1, 1.0, 0), (2, 0.75, 0), (3, 0.55, 0), (4, 0.35, 0), (5, 0.22, 0), (6, 0.12, 0), (7, 0.07, 0)]
BELL = [(1, 1.0, 1.4), (2.01, 0.55, 2.2), (3.02, 0.3, 3), (4.17, 0.22, 4), (5.43, 0.12, 6)]


def pad(mix, notes, at, dur, gain):
    for i, m in enumerate(notes):
        for cents, pan in ((-6, -0.6), (6, 0.6)):
            s = tone(hz(m), dur, PAD, detune_cents=cents, phase=i * 0.7)
            s *= env(len(s), min(1.2, dur / 3), min(1.0, dur / 3))
            mix.add(s, at, gain / len(notes), pan)


def bass(mix, m, at, dur, gain):
    s = tone(hz(m), dur, BASS) * env(int(dur * SR), 0.008, 0.08)
    mix.add(s, at, gain, 0.0)


def pluck(mix, m, at, dur, gain, pan):
    s = tone(hz(m), dur, PLUCK) * env(int(dur * SR), 0.003, 0.05)
    mix.add(s, at, gain, pan)


def horn(mix, m, at, dur, gain, pan=0.1):
    s = tone(hz(m), dur, HORN, vibrato=0.004)
    s *= env(len(s), 0.09, 0.25, sustain=0.85, decay=0.2)
    mix.add(s, at, gain, pan)


def kick(mix, at, gain):
    n = int(0.35 * SR)
    t = np.arange(n) / SR
    f = 45 + 110 * np.exp(-t * 28)
    s = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 9)
    mix.add(s, at, gain, 0.0)


def noise(n, seed):
    return np.random.default_rng(seed).standard_normal(n)


def snare(mix, at, gain, seed, length=0.2):
    n = int(length * SR)
    t = np.arange(n) / SR
    body = np.sin(2 * np.pi * 185 * t) * np.exp(-t * 30)
    rattle = np.diff(noise(n + 1, seed)) * 0.35 * np.exp(-t * (18 / length * 0.2))
    mix.add(body * 0.6 + rattle, at, gain, 0.05)


def hat(mix, at, gain, seed, pan=0.3):
    n = int(0.06 * SR)
    t = np.arange(n) / SR
    s = np.diff(np.diff(noise(n + 2, seed))) * 0.25 * np.exp(-t * 70)
    mix.add(s, at, gain, pan)


def timpani(mix, m, at, gain):
    n = int(2.2 * SR)
    t = np.arange(n) / SR
    f = hz(m) * (1 + 0.04 * np.exp(-t * 12))
    ph = 2 * np.pi * np.cumsum(f) / SR
    s = (np.sin(ph) + 0.35 * np.sin(1.5 * ph) + 0.2 * np.sin(1.98 * ph)) * np.exp(-t * 2.2)
    s += np.diff(noise(n + 1, int(at * 1000))) * 0.05 * np.exp(-t * 40)
    mix.add(s, at, gain, -0.1)


# --------------------------------------------------------------------------
# Composition helpers
# --------------------------------------------------------------------------


def chord(key, scale, degree, octave=4, size=3):
    """Notes (MIDI) of the diatonic chord on `degree` (0-based)."""
    out = []
    for k in range(size):
        idx = degree + 2 * k
        out.append(key + 12 * (octave - 4) + scale[idx % 7] + 12 * (idx // 7))
    return out


def melody(rng, key, scale, chords, beats_per_chord, octave=5):
    """A motif-based melody: a 2-bar idea, repeated with variation."""
    notes_in = lambda deg: key + 12 * (octave - 4) + scale[deg % 7] + 12 * (deg // 7)
    motif = []
    beat = 0.0
    while beat < beats_per_chord * 2:
        length = rng.choice([1.0, 1.0, 0.5, 2.0, 1.5])
        motif.append((beat, min(length, beats_per_chord * 2 - beat), rng.integers(0, 5)))
        beat += length
    line = []
    for ci, degree in enumerate(chords):
        if ci % 2:
            continue
        shift = 0 if (ci // 2) % 2 == 0 else int(rng.choice([1, 2, -1]))
        for start, length, step in motif:
            deg = degree + [0, 2, 4, 2, 0][step] + shift
            line.append((ci * beats_per_chord + start, length, notes_in(deg)))
    return line


def compose(spec):
    rng = np.random.default_rng(spec["seed"])
    bpm, key, scale = spec["bpm"], spec["key"], spec["scale"]
    beat = 60.0 / bpm
    bar = 4 * beat
    prog = spec["progression"]
    mix = Mix(spec["seconds"])
    t = 0.0
    section_index = 0
    while t < spec["seconds"] - bar:
        section = spec["sections"][section_index % len(spec["sections"])]
        section_index += 1
        for bi, degree in enumerate(prog):
            if t >= spec["seconds"] - bar:
                break
            on = section["parts"]
            notes = chord(key, scale, degree, octave=4, size=4 if "rich" in on else 3)
            if "pad" in on:
                pad(mix, [m - 12 for m in notes], t, bar * 1.02, section.get("pad", 0.32))
            if "bass" in on:
                for k, (pos, ln) in enumerate(spec["bass_rhythm"]):
                    root = notes[0] - 24 + (7 if k == len(spec["bass_rhythm"]) - 1 and "walk" in on else 0)
                    bass(mix, root, t + pos * beat, ln * beat, 0.42)
            if "arp" in on:
                steps = spec.get("arp_steps", 8)
                order = spec.get("arp_order", [0, 1, 2, 1, 3, 2, 1, 2])
                for k in range(steps):
                    m = (notes + [notes[0] + 12])[order[k % len(order)] % (len(notes) + 1)]
                    pluck(mix, m, t + k * bar / steps, bar / steps * 1.6, 0.16, -0.5 if k % 2 else 0.5)
            if "kick" in on:
                for pos in spec["kick"]:
                    kick(mix, t + pos * beat, 0.65)
            if "snare" in on:
                for pos in spec["snare"]:
                    snare(mix, t + pos * beat, 0.32, int(t * 1000 + pos * 10))
            if "march" in on:
                for k in range(16):
                    if k in (0, 3, 4, 6, 8, 11, 12, 13, 14, 15) or rng.random() < 0.15:
                        snare(mix, t + k * bar / 16, 0.13 + (0.08 if k % 4 == 0 else 0), int(t * 997 + k), 0.12)
            if "hats" in on:
                for k in range(8):
                    hat(mix, t + k * beat / 2, 0.11 if k % 2 else 0.07, int(t * 991 + k), 0.35 if k % 2 else -0.25)
            if "timpani" in on and bi % 2 == 0:
                timpani(mix, notes[0] - 24, t, 0.55)
                timpani(mix, notes[0] - 24, t + 3 * beat, 0.3)
            t += bar
        if "melody" in section["parts"]:
            start = t - bar * len(prog)
            for pos, length, m in melody(rng, key, scale, prog, 4):
                horn(mix, m, start + pos * beat, length * beat * 0.95, section.get("lead", 0.2))
    mix.echo(spec.get("echo", beat * 0.75), 0.42, spec.get("wet", 0.35))
    return mix.master(spec["seconds"])


# --------------------------------------------------------------------------
# Tracks
# --------------------------------------------------------------------------

TRACKS = {
    "music/openwars-menu.mp3": dict(
        seed=11, bpm=68, key=62, scale=MINOR, seconds=112,  # D minor
        progression=[0, 5, 2, 6, 0, 3, 4, 4],
        bass_rhythm=[(0, 4)],
        sections=[
            {"parts": {"pad", "rich"}, "pad": 0.3},
            {"parts": {"pad", "rich", "bass", "timpani", "melody"}, "lead": 0.17},
            {"parts": {"pad", "rich", "bass", "arp", "melody"}, "lead": 0.2},
        ],
        arp_steps=8, wet=0.45,
    ),
    "music/openwars-gameplay-1.mp3": dict(
        seed=23, bpm=108, key=57, scale=MINOR, seconds=206,  # A minor, march
        progression=[0, 0, 5, 6, 0, 3, 4, 4],
        bass_rhythm=[(0, 1), (1.5, 0.5), (2, 1), (3, 1)],
        kick=[0, 2], snare=[1, 3],
        sections=[
            {"parts": {"march", "bass", "pad"}},
            {"parts": {"march", "bass", "pad", "kick", "melody"}, "lead": 0.16},
            {"parts": {"march", "bass", "pad", "kick", "snare", "arp"}},
            {"parts": {"march", "bass", "pad", "kick", "melody", "timpani", "walk"}, "lead": 0.18},
        ],
        arp_steps=8,
    ),
    "music/openwars-gameplay-2.mp3": dict(
        seed=37, bpm=92, key=64, scale=MINOR, seconds=204,  # E minor, tense
        progression=[0, 5, 0, 6, 3, 3, 4, 6],
        bass_rhythm=[(0, 0.5), (0.5, 0.5), (1, 0.5), (1.5, 0.5), (2, 0.5), (2.5, 0.5), (3, 0.5), (3.5, 0.5)],
        kick=[0, 2.5], snare=[2],
        sections=[
            {"parts": {"pad", "arp"}},
            {"parts": {"pad", "arp", "bass", "hats"}},
            {"parts": {"pad", "arp", "bass", "hats", "kick", "melody"}, "lead": 0.14},
            {"parts": {"pad", "bass", "kick", "snare", "hats", "timpani"}},
        ],
        arp_steps=16, arp_order=[0, 2, 1, 3, 2, 1, 0, 2], wet=0.4,
    ),
    "music/openwars-gameplay-3.mp3": dict(
        seed=51, bpm=126, key=60, scale=MINOR, seconds=212,  # C minor, driving
        progression=[0, 6, 5, 4, 0, 6, 3, 4],
        bass_rhythm=[(0, 0.5), (0.5, 0.5), (1, 0.5), (1.5, 0.5), (2, 0.5), (2.5, 0.5), (3, 0.5), (3.5, 0.5)],
        kick=[0, 1, 2, 3], snare=[1, 3],
        sections=[
            {"parts": {"bass", "kick", "hats", "pad"}},
            {"parts": {"bass", "kick", "hats", "snare", "arp", "pad"}},
            {"parts": {"bass", "kick", "hats", "snare", "pad", "melody", "rich"}, "lead": 0.15},
            {"parts": {"pad", "arp", "timpani", "rich"}},
            {"parts": {"bass", "kick", "hats", "snare", "arp", "melody", "pad"}, "lead": 0.16},
        ],
        arp_steps=16, arp_order=[0, 1, 2, 3, 2, 1, 2, 3],
    ),
}


def game_start_chime():
    """A rising bell arpeggio, the 'your game is starting' alert."""
    mix = Mix(2.6)
    for i, m in enumerate([72, 76, 79, 84]):  # C major, rising
        s = tone(hz(m), 1.9, BELL) * env(int(1.9 * SR), 0.004, 0.4)
        mix.add(s, 0.02 + i * 0.13, 0.5, -0.4 + i * 0.27)
    s = tone(hz(60), 2.2, PAD) * env(int(2.2 * SR), 0.05, 1.0)
    mix.add(s, 0.02, 0.18)
    mix.echo(0.19, 0.35, 0.3, taps=4)
    return mix.master(2.53, fade_in=0.002, fade_out=0.5, peak=0.8)


def write_mp3(stereo, path, quality):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    pcm = (np.clip(stereo.T, -1, 1) * 32767).astype("<i2")
    with tempfile.TemporaryDirectory() as tmp:
        wav_path = os.path.join(tmp, "out.wav")
        with wave.open(wav_path, "wb") as w:
            w.setnchannels(2)
            w.setsampwidth(2)
            w.setframerate(SR)
            w.writeframes(pcm.tobytes())
        subprocess.run(
            ["ffmpeg", "-loglevel", "error", "-y", "-i", wav_path,
             "-codec:a", "libmp3lame", "-q:a", str(quality), "-map_metadata", "-1",
             "-bitexact", path],
            check=True,
        )


def main():
    only = sys.argv[1:]
    for name, spec in TRACKS.items():
        if only and name not in only:
            continue
        print(f"composing {name} ...", flush=True)
        write_mp3(compose(spec), os.path.join(OUT, name), quality=4)
    if not only or "effects/openwars-game-start.mp3" in only:
        print("composing effects/openwars-game-start.mp3 ...", flush=True)
        write_mp3(game_start_chime(), os.path.join(OUT, "effects", "openwars-game-start.mp3"), quality=2)


if __name__ == "__main__":
    main()
