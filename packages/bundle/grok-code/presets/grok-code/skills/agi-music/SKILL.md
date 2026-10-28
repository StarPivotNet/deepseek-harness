---
name: agi-music
description: "Use for writing music as code with scribbletune and spessasynth_core: a song, a beat, a loop, a score, or a SoundFont arrangement rendered to wav. Not a Remotion timeline."
---

# scribbletune and SpessaSynth

Load this skill before writing music as code. scribbletune writes the notes. `spessasynth_core` renders those notes with a SoundFont. A Remotion timeline is `remotion-best-practices`.

Contracts below were checked against scribbletune 5.5.5 and spessasynth_core 4.3.22. If the import fails, install those versions. If a different version is already installed, read its types before calling.

Take tempo, key, density, and dynamics from the request. When the request names none of them, pick one concrete value and state it in the delivery.

## When

**Do:** a song, a beat, a loop, a chord progression, a bass line, a drum pattern, a lead, or a full arrangement the user asked to hear.

**Skip:** a request to edit an existing wav or mp3 with ffmpeg.

## Score

1. Build every part with `clip` from `scribbletune`. Notes come from `scale`, `chord`, `arp`, `progression`, or `getChordsByProgression`. Done when each part is the array `clip` returned.
2. The pattern language is `x` (hit), `_` (hold the previous hit), `-` (rest), `R` (random hit), and `[abc]` (split one step). `subdiv: '4n'` is one quarter note and 128 ticks. A 4/4 bar is 4 steps and 512 ticks. A hit plus `_` is one longer note, not a copy of the event.
3. Name the key and the chord symbols (`C4 major`, `I V vi IV`). `getChordsByProgression` expands symbols. The octave in the tonic is the octave of degree 1. Later degrees keep the octave the scale gives them, which may cross into the next octave. Case selects major or minor. A trailing `7` selects `maj7` or `m7`. `°` selects `7b5`. `+` selects `#5`. Spell a dominant seventh as pitch names: `VII7` is a major seventh, not a dominant seventh. `arp` count is 2 through 8; a count larger than the chord lifts the extra tones by octaves. When the symbol is the wrong quality or register, pass pitch names to `clip`. `clip` returns `note` as an array of pitch names, `length` in ticks, and `level` (default 100).
4. A section is a concatenated clip or a repeated pattern. The score does not copy the same events and does not branch on `bar === n`. Parts that share a timeline share one tick length. A later entrance is leading `-` rests, or a rest clip concatenated in front. `sizzle` and `accent` rewrite every event in that clip, and a rest is an event, so shape dynamics on a clip of only the notes they should change.

## MIDI

One timbre, channel 0, General MIDI program 0: `midi(notes, null, bpm)` returns a binary string whose first four characters are `MThd`. Convert with `Uint8Array.from(raw, (ch) => ch.charCodeAt(0))`. Use `midi` only when that single part has no leading rest. `midi` and `Track.addChord` start every chord at delta 0, so a preceding rest is dropped.

More than one timbre: do not call `midi`. It writes a single channel. Build one `File` and one `Track` per part from `@scribbletune/midi`. Leave ticks at 128. Call `setTempo(bpm)` on the first track. Each extra track is its own timeline, so the parts play together. Call `setInstrument(channel, program, 0)` before the notes. The program is 0-based General MIDI: acoustic piano is 0, not 1. Channel 9 is the drum kit. Channel volume (CC 7), pan (CC 10), and reverb send (CC 91) are events at delta 0 on that track, before the notes. Write each `clip` event in order: a rest adds its `length` to the next note-on delta; each pitch in `note` gets `noteOn` at delta 0 except the first pitch of the event, which gets the pending rest; the first `noteOff` carries `length` and the other pitches of that chord get delta 0. `noteOn` and `noteOff` treat a 0 velocity as 90, so skip a rest instead of emitting one. Done when `File.toUint8Array()` begins with `MThd` and each part is its own track.

## Render

Run this in Node. The sound bank is a local `.sf2`, `.sf3`, or `.dls`. Use the path the user named. If they named none, use one already in the project. On Windows, with neither of those, use `C:\Windows\System32\drivers\gm.dls`. Copy file bytes into a new `Uint8Array` before `fromArrayBuffer`.

```js
import { readFile, writeFile } from 'node:fs/promises'
import {
  audioToWav,
  BasicMIDI,
  SoundBankLoader,
  SpessaSynthProcessor,
  SpessaSynthSequencer,
} from 'spessasynth_core'

const sampleRate = 48000
const midi = BasicMIDI.fromArrayBuffer(Uint8Array.from(midiBytes).buffer)
const bankBytes = Uint8Array.from(await readFile(bankPath))
const bank = SoundBankLoader.fromArrayBuffer(bankBytes.buffer)
const synth = new SpessaSynthProcessor(sampleRate, { eventsEnabled: false })
synth.soundBankManager.addSoundBank(bank, 'main')
await synth.processorInitialized
const seq = new SpessaSynthSequencer(synth)
seq.loopCount = 0
seq.skipToFirstNoteOn = false
seq.loadNewSongList([midi])
seq.play()
const sampleCount = Math.ceil(sampleRate * (midi.duration + 2))
const left = new Float32Array(sampleCount)
const right = new Float32Array(sampleCount)
for (let filled = 0; filled < sampleCount; ) {
  seq.processTick()
  const count = Math.min(128, sampleCount - filled)
  synth.process(left, right, filled, count)
  filled += count
}
await writeFile(outPath, Buffer.from(audioToWav([left, right], sampleRate)))
```

`skipToFirstNoteOn` defaults to true and drops an opening rest. `loopCount` stays 0 so a loop point cannot replay inside the tail.

Done when the wav starts with `RIFF`, its length covers `midi.duration` plus the two-second tail, and the peak is above silence and below clipping. A silent file means the bank or the program failed. Clipping means lower `level` or CC 7 and render again.

## Deliver

Write the wav and one HTML file that starts playback on a click or key. The page shows BPM, key, and the section name. When the form has more than one section, set that name from `audio.currentTime` and the score's bar duration. Autoplay is blocked. `present` both paths. State the BPM, the key, the form, the sound bank file name, and the peak. Do not claim it sounds like a named artist.

## Don't

- Do not play the score through Tone.js, a `scribbletune` channel, or hand-built oscillators.
- Do not import `spessasynth_lib`.
- Do not put two parts on one track. Deltas would play them one after another.
- Do not download a sound bank, and do not scan the home directory for one.
- Do not schedule the piece with `setTimeout`.
