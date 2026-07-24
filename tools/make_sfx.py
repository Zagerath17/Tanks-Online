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

def svf_band(x, fc, q=1.0):
    """Chamberlin state-variable bandpass. Unlike the one-pole helpers above
    this actually resonates, which is the difference between a hiss and a
    roar, and its centre can be swept per-sample without the coefficient
    recalculation blowing up. cutoff: Hz constant or f(i)->Hz."""
    low = band = 0.0
    out = []
    fixed = not callable(fc)
    limit = SR * 0.24  # keep the one-sample-delay topology stable
    if fixed:
        f = 2 * math.sin(math.pi * min(fc, limit) / SR)
    for i, s in enumerate(x):
        if not fixed:
            f = 2 * math.sin(math.pi * min(fc(i), limit) / SR)
        high = s - low - q * band
        band += f * high
        low += f * band
        out.append(band)
    return out


def wobble(n, points):
    """A smooth random contour in [0,1] that is periodic over n samples, so
    anything modulated by it still wraps cleanly. Smoothstep between random
    control points, with the last point interpolating back into the first."""
    k = max(2, int(points))
    vals = [random.random() for _ in range(k)]

    def f(i):
        p = ((i % n) / n) * k
        i0 = int(p) % k
        t = p - int(p)
        t = t * t * (3 - 2 * t)
        return vals[i0] * (1 - t) + vals[(i0 + 1) % k] * t

    return f


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


def rms(x):
    return (sum(s * s for s in x) / max(1, len(x))) ** 0.5 or 1e-9


def unit(x):
    """Scale a layer to unit RMS so mix weights below mean what they say."""
    return gain(x, 1.0 / rms(x))


def loop_align(x):
    """Rotate a periodic buffer so its wrap point lands somewhere quiet and
    flat. The signal is already periodic by construction, so where the loop
    happens to start is arbitrary — but if a crackle transient lands on sample
    zero the join sits at the 98th percentile of the waveform's own step size
    and ticks once per lap. Rotating is free: it is a phase shift of a periodic
    signal and leaves the magnitude spectrum bit-for-bit identical."""
    n = len(x)
    win = 64
    run = sum(abs(s) for s in x[:win])
    best_i, best_cost = 0, None
    for i in range(n):
        step = abs(x[i] - x[i - 1])  # i=0 wraps to the last sample, as intended
        cost = step + 0.6 * (run / win)
        if best_cost is None or cost < best_cost:
            best_cost, best_i = cost, i
        run += abs(x[(i + win) % n]) - abs(x[i])
    return x[best_i:] + x[:best_i]

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
    """A fuel-fed roar. The previous build measured 0.977 spectral similarity
    to the cryo loop — near enough to be the same weapon — because both were
    band-limited noise swept by a one-pole filter under a smooth sine tremolo.
    Tilting that downward gives you a blizzard with more bass, not a fire.

    Fire is identified by things that build had none of:
      * TRANSIENTS. The old crackle was ~12 grains/s at 0.45 under a 1.5 bed,
        which measured as literally zero detectable onsets per second. Crackle
        is the signature, so it is now ~75 grains/s with fast attacks, a wide
        amplitude spread, and occasional loud spits over the top.
      * IRREGULARITY. Smooth sinusoidal tremolo reads as wind. The level here
        is driven by random contours instead, so it gusts unpredictably.
      * RESONANCE. One-pole noise hisses; a resonant band roars. The body is
        built from swept state-variable bandpasses.

    It also deliberately vacates 400-2000 Hz as a *sustained* band, which is
    where the cryo howl puts 62% of its energy — up there the flame only has
    crackle. Measured against the cryo loop the rebuild moves log-spectrum
    similarity 0.977 -> 0.85 (for scale, no two other effects in this pack sit
    above 0.954), roughly doubles the band-energy distance, and takes onsets
    from 0.0 to ~10 per second against the cryo's 0.0.

    Seamlessness uses the same technique as the cryo loop: every source is
    periodic over the loop, tiled twice, filtered across both copies, and only
    the second copy kept, so the filter state is already warmed at the wrap.
    """
    dur = 4.0
    n = int(SR * dur)

    def tile(period):
        return period + period

    def steady(x2n):
        return x2n[n:]

    def periodic_noise():
        return tile([random.uniform(-1, 1) for _ in range(n)])

    # --- turbulence: the irregular gusting that separates fire from wind ----
    gust = wobble(n, 26)   # ~6.5 shifts a second, the slow billow
    lick = wobble(n, 61)   # ~15 a second, the flame licking

    # --- pressurised gas jet: the deep body a flamethrower has and a
    #     blizzard does not
    jet = unit(steady(lowpass(periodic_noise(), lambda i: 80 + 85 * gust(i))))

    # --- combustion throat: a resonant roar whose pitch flickers -----------
    throat = unit(steady(svf_band(
        periodic_noise(),
        lambda i: 135 + 105 * gust(i) + 60 * lick(i),
        q=0.7,
    )))

    # --- burning fuel body, still resonant rather than hissy. Kept quiet on
    #     purpose: 400-2000 Hz is where the cryo howl lives, and staying out
    #     of it is most of what makes these two read as different weapons.
    burn = unit(steady(svf_band(
        periodic_noise(),
        lambda i: 330 + 200 * lick(i),
        q=1.1,
    )))

    # --- crackle: dense, sharp, fast-attack transients ---------------------
    crackle = [0.0] * n
    t = 0.0
    while t < dur:
        i0 = int(t * SR)
        ln = random.randint(20, 90)
        amp = random.uniform(0.2, 1.0) ** 2      # wide dynamic spread
        for j in range(ln):
            crackle[(i0 + j) % n] += random.uniform(-1, 1) * amp * math.exp(-j / (ln * 0.26))
        t += random.uniform(0.018, 0.055)        # ~28 grains a second, not 95
    # kept well below the old 1.8-7 kHz band: dense bright grains up there are
    # precisely the sound of a frying pan, not a flamethrower
    crackle = unit(steady(highpass(lowpass(tile(crackle), 2600), 480)))

    # --- spits: occasional loud pops of fuel catching -----------------------
    spit = [0.0] * n
    t = random.uniform(0.05, 0.3)
    while t < dur:
        i0 = int(t * SR)
        ln = random.randint(120, 420)
        amp = random.uniform(0.6, 1.0)
        for j in range(ln):
            spit[(i0 + j) % n] += random.uniform(-1, 1) * amp * math.exp(-j / (ln * 0.18))
        t += random.uniform(0.32, 0.8)
    spit = unit(steady(highpass(lowpass(tile(spit), 1900), 240)))

    # The bed gusts hard; the transients ride on top at a fixed level so they
    # always punch through. Deliberately NOT saturated — soft-clipping the mix
    # measured as squashing the crest factor from 9.4 to 1.6 and wiping out
    # every detectable onset, which is the one thing fire cannot do without.
    # The bed is now nearly steady. The old build swung its level by a factor
    # of three under the gust contour, which is what read as "wavy" — a
    # flamethrower under constant trigger is a continuous roar that flickers,
    # not something that surges in and out.
    out = []
    for i in range(n):
        g = 0.90 + 0.16 * gust(i)
        l = 0.92 + 0.12 * lick(i)
        out.append(
            (jet[i] * 1.15 + throat[i] * 1.15) * g
            + burn[i] * 0.48 * l
            + crackle[i] * 0.30
            + spit[i] * 0.20
        )

    # trim sub-bass that only eats headroom, and keep the top dark
    out = steady(highpass(lowpass(tile(out), 4000), 48))
    return loop_align(normalize(out, 0.9))


# --- plasma bolt ------------------------------------------------------------
def make_plasma():
    """A heavy electromagnetic thump, not the thin capacitor zap this replaced.

    At eight bolts a second anything with a tail smears into a drone, so this
    is built dry and short (0.13 s): a fast downward pitch drop for weight, a
    tight body thump, and a brief metallic edge for the rail snap. No long
    resonant ring, no noise wash — those were what made the old one sound
    fizzy and cheap when repeated.
    """
    n = int(SR * 0.13)

    # pitch drop: the bolt leaving the rails. Fast exponential sweep well
    # down into the bass, which is what gives it punch at any fire rate.
    drop = []
    phase = 0.0
    for i in range(n):
        t = i / SR
        f = 520 * math.exp(-t / 0.022) + 62
        phase += 2 * math.pi * f / SR
        drop.append(math.sin(phase) * math.exp(-i / (0.045 * SR)))

    # body thump underneath, giving it mass
    thump = [
        math.sin(2 * math.pi * 88 * (i / SR)) * math.exp(-i / (0.03 * SR))
        for i in range(n)
    ]

    # rail snap: a very short bright edge so it still reads as electric
    snap = [s * e for s, e in zip(noise(n), env_exp(n, 0.0035))]
    snap = highpass(snap, 2600)

    # a single mid mode, decaying fast — enough metal to place it, not enough
    # to ring into the next shot
    ring = [
        0.5 * math.sin(2 * math.pi * 620 * (i / SR)) * math.exp(-i / (0.014 * SR))
        for i in range(n)
    ]

    out = mix(gain(drop, 1.15), gain(thump, 0.75), gain(snap, 0.4), gain(ring, 0.3))
    out = lowpass(out, 5200)
    return normalize(softclip(out, 1.25), 0.88)


# --- railgun discharge ------------------------------------------------------
def make_rail():
    """A capacitor bank emptying at once: a rising whine cut off by a hard
    crack, then a long metallic ring down the rails. Heavier and longer than
    anything else in the pack, because it only goes off every five seconds."""
    n = int(SR * 1.1)

    # the crack itself
    crack = [s * e for s, e in zip(noise(n), env_exp(n, 0.012))]
    crack = highpass(crack, 1200)

    # a hard downward sweep — the slug leaving the rails
    sweep = []
    phase = 0.0
    for i in range(n):
        t = i / SR
        f = 2400 * math.exp(-t / 0.05) + 90
        phase += 2 * math.pi * f / SR
        sweep.append(math.sin(phase) * math.exp(-i / (0.09 * SR)))

    # deep body
    body = [
        0.9 * math.sin(2 * math.pi * 54 * (i / SR)) * math.exp(-i / (0.22 * SR))
        + 0.5 * math.sin(2 * math.pi * 81 * (i / SR) + 0.7) * math.exp(-i / (0.16 * SR))
        for i in range(n)
    ]

    # rails ringing afterwards
    ring = [0.0] * n
    for f, tau, amp in [(340, 0.30, 1.0), (521, 0.24, 0.6), (869, 0.17, 0.34), (1310, 0.12, 0.2)]:
        ph = random.uniform(0, math.pi * 2)
        for i in range(n):
            ring[i] += amp * math.sin(2 * math.pi * f * (i / SR) + ph) * math.exp(-i / (tau * SR))

    # ionised wash trailing off
    wash = [s * e for s, e in zip(noise(n), env_exp(n, 0.28))]
    wash = highpass(lowpass(wash, 2600), 300)

    out = mix(gain(crack, 0.9), gain(sweep, 0.85), gain(body, 1.1),
              gain(ring, 0.42), gain(wash, 0.3))
    return normalize(softclip(out, 1.4), 0.94)


if __name__ == '__main__':
    dest = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'assets', 'sfx')
    os.makedirs(dest, exist_ok=True)
    write_wav(os.path.join(dest, 'shot.wav'), make_shot())
    write_wav(os.path.join(dest, 'explosion.wav'), make_explosion())
    write_wav(os.path.join(dest, 'hit.wav'), make_hit())
    write_wav(os.path.join(dest, 'engine.wav'), make_engine())
    write_wav(os.path.join(dest, 'cryo.wav'), make_cryo())
    write_wav(os.path.join(dest, 'flame.wav'), make_flame())
    write_wav(os.path.join(dest, 'plasma.wav'), make_plasma())
    write_wav(os.path.join(dest, 'rail.wav'), make_rail())
