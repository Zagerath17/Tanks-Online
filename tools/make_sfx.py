#!/usr/bin/env python3
"""Generate sample-quality sound effects as WAV files (no dependencies).

Layered noise + resonance design, not musical synth tones:
  shot.wav      - cannon: sharp crack + low thump + filtered noise body
  explosion.wav - deep rumble, noise wash, crackle, long tail
  hit.wav       - metallic armor clank
  engine.wav    - seamless diesel idle loop (pitch-shifted in game)
"""
import math
import random
import struct
import wave
import os

SR = 22050
random.seed(7)

def lowpass(x, cutoff):
    """One-pole lowpass. cutoff: Hz constant or f(i)->Hz."""
    y = 0.0
    out = []
    fixed = not callable(cutoff)
    if fixed:
        a = 1 - math.exp(-2 * math.pi * cutoff / SR)
    for i, s in enumerate(x):
        if not fixed:
            a = 1 - math.exp(-2 * math.pi * cutoff(i) / SR)
        y += a * (s - y)
        out.append(y)
    return out

def highpass(x, cutoff):
    lp = lowpass(x, cutoff)
    return [s - l for s, l in zip(x, lp)]

def env_exp(n, tau):
    return [math.exp(-i / (tau * SR)) for i in range(n)]

def noise(n):
    return [random.uniform(-1, 1) for _ in range(n)]

def mix(*layers):
    n = max(len(l) for l in layers)
    out = [0.0] * n
    for l in layers:
        for i, s in enumerate(l):
            out[i] += s
    return out

def gain(x, g):
    return [s * g for s in x]

def softclip(x, drive=1.6):
    return [math.tanh(s * drive) for s in x]

def normalize(x, peak=0.9):
    m = max(abs(s) for s in x) or 1.0
    return [s * peak / m for s in x]

def write_wav(path, x):
    with wave.open(path, 'w') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        frames = b''.join(
            struct.pack('<h', int(max(-1.0, min(1.0, s)) * 32767)) for s in x
        )
        w.writeframes(frames)
    print(f'{path}: {len(x) / SR:.2f}s')

# --- cannon shot ------------------------------------------------------------
def make_shot():
    n = int(SR * 0.75)
    # sharp crack: short bright noise
    crack = [s * e for s, e in zip(noise(n), env_exp(n, 0.012))]
    crack = highpass(crack, 900)
    # body: noise through a falling lowpass
    body = [s * e for s, e in zip(noise(n), env_exp(n, 0.13))]
    body = lowpass(body, lambda i: 2800 * math.exp(-i / (0.09 * SR)) + 220)
    # thump: low sine knocks
    thump = [
        0.9 * math.sin(2 * math.pi * 68 * (i / SR)) * math.exp(-i / (0.12 * SR))
        + 0.7 * math.sin(2 * math.pi * 44 * (i / SR)) * math.exp(-i / (0.22 * SR))
        for i in range(n)
    ]
    out = mix(gain(crack, 0.9), gain(body, 1.5), gain(thump, 1.0))
    return normalize(softclip(out, 1.8), 0.92)

# --- explosion --------------------------------------------------------------
def make_explosion():
    n = int(SR * 2.3)
    crack = [s * e for s, e in zip(noise(n), env_exp(n, 0.02))]
    wash = [s * e for s, e in zip(noise(n), env_exp(n, 0.5))]
    wash = lowpass(wash, lambda i: 1400 * math.exp(-i / (0.35 * SR)) + 130)
    rumble = [
        0.9 * math.sin(2 * math.pi * 36 * (i / SR)) * math.exp(-i / (0.75 * SR))
        + 0.6 * math.sin(2 * math.pi * 52 * (i / SR) + 1.3) * math.exp(-i / (0.55 * SR))
        for i in range(n)
    ]
    # debris crackle: sparse decaying bursts
    crackle = [0.0] * n
    t = 0.03
    while t < 1.5:
        i0 = int(t * SR)
        ln = random.randint(60, 260)
        amp = 0.9 * math.exp(-t / 0.5) * random.uniform(0.4, 1.0)
        for j in range(min(ln, n - i0)):
            crackle[i0 + j] += random.uniform(-1, 1) * amp * math.exp(-j / 40.0)
        t += random.uniform(0.02, 0.09)
    crackle = highpass(crackle, 500)
    out = mix(gain(crack, 0.8), gain(wash, 1.6), gain(rumble, 1.2), gain(crackle, 0.5))
    return normalize(softclip(out, 1.7), 0.95)

# --- armor hit --------------------------------------------------------------
def make_hit():
    n = int(SR * 0.5)
    # heavy plate ring — low modes so it reads as armor, not a tin can
    modes = [(148, 0.16, 1.0), (241, 0.12, 0.8), (397, 0.09, 0.6),
             (622, 0.065, 0.45), (938, 0.05, 0.3)]
    ring = [0.0] * n
    for f, tau, amp in modes:
        ph = random.uniform(0, math.pi * 2)
        for i in range(n):
            ring[i] += amp * math.sin(2 * math.pi * f * (i / SR) + ph) * math.exp(-i / (tau * SR))
    # impact thud underneath
    thump = [
        0.9 * math.sin(2 * math.pi * 74 * (i / SR)) * math.exp(-i / (0.06 * SR))
        + 0.55 * math.sin(2 * math.pi * 47 * (i / SR)) * math.exp(-i / (0.11 * SR))
        for i in range(n)
    ]
    # noise punch with a falling lowpass
    punch = [s * e for s, e in zip(noise(n), env_exp(n, 0.035))]
    punch = lowpass(punch, lambda i: 2400 * math.exp(-i / (0.03 * SR)) + 260)
    out = mix(gain(ring, 0.85), gain(thump, 1.0), gain(punch, 1.1))
    return normalize(softclip(out, 1.9), 0.92)

# --- engine idle loop (seamless: 1.0 s, integer-Hz partials) ----------------
def make_engine():
    n = SR  # exactly 1 second so integer frequencies loop cleanly
    harmonics = [(28, 1.0), (56, 0.55), (84, 0.38), (112, 0.24), (140, 0.15), (196, 0.09)]
    phases = {f: random.uniform(0, math.pi * 2) for f, _ in harmonics}
    out = []
    for i in range(n):
        t = i / SR
        s = sum(a * math.sin(2 * math.pi * f * t + phases[f]) for f, a in harmonics)
        # 14 Hz cylinder chug (integer Hz -> loops)
        chug = 0.55 + 0.45 * max(0.0, math.sin(2 * math.pi * 14 * t)) ** 2
        out.append(s * chug)
    # mechanical breath: looped filtered noise, crossfaded at the seam
    nz = lowpass(noise(n), 360)
    fade = int(0.1 * SR)
    for i in range(fade):
        w = i / fade
        nz[i] = nz[i] * w + nz[n - fade + i] * (1 - w)
    out = mix(gain(out, 1.0), gain(nz, 0.5))
    return normalize(out, 0.6)

# --- cryo stream (seamless 4.0 s loop) --------------------------------------
def make_cryo():
    """A blizzard howl. Three earlier attempts failed in specific ways:
    a broadband hiss read as an aerosol can, a slow 0.5 Hz swell read as
    surf, and tonal sine 'pings' were recognisable enough to sound repetitive
    on a short loop.

    This build howls in a narrow resonant band with fast flutter (no slow
    swell), replaces the pings with dense granular sleet, and runs 4 s long.

    Seamlessness is structural rather than patched: every noise source is
    itself periodic over the loop, tiled twice, filtered across both copies,
    and only the SECOND copy is kept. That leaves the filter state already
    warmed and periodic, so the wrap point continues smoothly instead of
    restarting from a silent filter (which was the hard break before).
    """
    dur = 4.0
    n = int(SR * dur)

    def tile(period):
        return period + period

    def steady(x2n):
        return x2n[n:]

    def periodic_noise():
        return tile([random.uniform(-1, 1) for _ in range(n)])

    # --- the howl: a narrow band whose centre flutters quickly --------------
    howl = lowpass(
        periodic_noise(),
        lambda i: 780
        + 260 * math.sin(2 * math.pi * 1.25 * ((i % n) / SR))
        + 120 * math.sin(2 * math.pi * 3.0 * ((i % n) / SR) + 0.8),
    )
    howl = steady(highpass(howl, 300))

    # --- thin cold air riding on top ---------------------------------------
    air = steady(highpass(lowpass(periodic_noise(), 2600), 1200))

    # --- a little low body; too much of this is what sounded like the sea ---
    bed = [
        0.5 * math.sin(2 * math.pi * 47 * (i / SR))
        + 0.3 * math.sin(2 * math.pi * 71 * (i / SR) + 1.2)
        for i in range(n)
    ]

    # --- sleet: dense, very short noise grains, wrapped so they loop --------
    sleet = [0.0] * n
    t = 0.0
    while t < dur:
        i0 = int(t * SR)
        ln = random.randint(18, 70)
        amp = random.uniform(0.25, 0.8)
        for j in range(ln):
            sleet[(i0 + j) % n] += random.uniform(-1, 1) * amp * math.exp(-j / (ln * 0.4))
        t += random.uniform(0.012, 0.05)  # roughly 30 grains a second
    sleet = steady(highpass(lowpass(tile(sleet), 4200), 1500))

    out = []
    for i in range(n):
        tt = i / SR
        # fast flutter only — every rate divides the loop length exactly
        flutter = (
            0.87
            + 0.08 * math.sin(2 * math.pi * 3.0 * tt)
            + 0.05 * math.sin(2 * math.pi * 5.25 * tt + 1.7)
        )
        out.append(howl[i] * 1.9 * flutter + air[i] * 0.18 + bed[i] * 0.15 + sleet[i] * 0.26)

    out = steady(lowpass(tile(out), 2300))
    return normalize(out, 0.8)


# --- flame stream (seamless 4.0 s loop) -------------------------------------
def make_flame():
    """A fuel-fed roar: low combustion rumble, a broad throaty body, and
    irregular crackle. Built with the same periodic-source technique as the
    cryo loop so the wrap point is continuous."""
    dur = 4.0
    n = int(SR * dur)

    def tile(period):
        return period + period

    def steady(x2n):
        return x2n[n:]

    def periodic_noise():
        return tile([random.uniform(-1, 1) for _ in range(n)])

    # combustion rumble: low noise with a slow-moving cutoff
    rumble = lowpass(
        periodic_noise(),
        lambda i: 240 + 90 * math.sin(2 * math.pi * 0.75 * ((i % n) / SR)),
    )
    rumble = steady(rumble)

    # throaty body of the flame
    body = lowpass(
        periodic_noise(),
        lambda i: 1150
        + 420 * math.sin(2 * math.pi * 2.0 * ((i % n) / SR))
        + 180 * math.sin(2 * math.pi * 4.25 * ((i % n) / SR) + 1.3),
    )
    body = steady(highpass(body, 260))

    # crackle: sparse, sharp bursts of burning fuel
    crackle = [0.0] * n
    t = 0.0
    while t < dur:
        i0 = int(t * SR)
        ln = random.randint(40, 190)
        amp = random.uniform(0.3, 1.0)
        for j in range(ln):
            crackle[(i0 + j) % n] += random.uniform(-1, 1) * amp * math.exp(-j / (ln * 0.3))
        t += random.uniform(0.03, 0.13)
    crackle = steady(highpass(lowpass(tile(crackle), 3400), 700))

    # roar partials, all multiples of 0.25 Hz so they wrap
    roar = [
        0.55 * math.sin(2 * math.pi * 58 * (i / SR))
        + 0.35 * math.sin(2 * math.pi * 87 * (i / SR) + 0.9)
        for i in range(n)
    ]

    out = []
    for i in range(n):
        tt = i / SR
        surge = (
            0.84
            + 0.10 * math.sin(2 * math.pi * 2.5 * tt)
            + 0.06 * math.sin(2 * math.pi * 6.25 * tt + 2.2)
        )
        out.append(
            rumble[i] * 1.5 * surge
            + body[i] * 1.05 * surge
            + crackle[i] * 0.45
            + roar[i] * 0.22
        )

    out = steady(lowpass(tile(out), 3600))
    return normalize(out, 0.85)


if __name__ == '__main__':
    dest = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'assets', 'sfx')
    os.makedirs(dest, exist_ok=True)
    write_wav(os.path.join(dest, 'shot.wav'), make_shot())
    write_wav(os.path.join(dest, 'explosion.wav'), make_explosion())
    write_wav(os.path.join(dest, 'hit.wav'), make_hit())
    write_wav(os.path.join(dest, 'engine.wav'), make_engine())
    write_wav(os.path.join(dest, 'cryo.wav'), make_cryo())
    write_wav(os.path.join(dest, 'flame.wav'), make_flame())
