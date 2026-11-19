# Active Processing Status

## Behavior

The category switch, selected quick preset, and manual override now live in one persisted sound-selection model. Mobile and desktop status text are derived from that model, not independent flags.

| Actual mode | Badge | Tap the badge |
|---|---|---|
| Category only | Category name | Disable category; normal stereo remains |
| Category and quick preset | Category + HD Clear / Immersive / Chill | Disable only category; keep preset |
| Quick preset only | HD Clear / Immersive / Chill | Enable category; keep preset |
| Neither enabled | Normal Stereo | Enable category |
| Manual DSP edits | Manual Override | Restore category and retained preset, or category alone |
| Bypass All | Raw Stereo | Disabled; leave bypass through its existing control |
| Native update pending | Applying... | Wait for native acknowledgement |

Category processing is on by default. A user-disabled category stays disabled across launches. The pills are mutually exclusive; selecting the active pill again removes only that pill, not category processing.

Manual edits suspend automatic processing without erasing the selected pill. Selecting a pill while in manual mode applies that pill rather than accidentally toggling it off. New track metadata cannot overwrite manual settings.

The new state is stored under `dmex_sound_selection_v1`. Existing manual mode and preset choices are migrated from legacy app settings when no new state exists. A new saved state takes precedence over legacy flags.

## Engine Behavior

Category-only mode now has its own restrained recipes; previously the no-pill branch returned neutral values regardless of category. Category-plus-pill processing continues to use the documented source-aware quick recipes.

Category-only recipes keep 9D, reverb, exciter, air (except the small explicit values below), loudness, compressor, room bass and speaker boost off. Volume, output device and headphone calibration remain unchanged.

| Category | Bass drive | Treble dB | Width | Vocal | Air |
|---|---:|---:|---:|---:|---:|
| Pop | .10 | .3 | 1.02 | .03 | 0 |
| Classical | .04 | .2 | 1.03 | 0 | 0 |
| Jazz | .05 | .1 | 1.02 | 0 | 0 |
| Vocal | .05 | .3 | 1 | .08 | 0 |
| Folk | .04 | .2 | 1 | .06 | 0 |
| Electronic | .14 | .2 | 1.04 | 0 | .02 |
| Hip-Hop | .16 | 0 | 1.02 | .04 | 0 |
| R&B | .10 | .2 | 1.02 | .06 | 0 |
| Rock | .08 | .2 | 1.03 | .04 | 0 |
| Metal | .06 | -.2 | 1.02 | .02 | 0 |
| Soundtrack | .06 | 0 | 1.04 | 0 | .02 |
| Speech | 0 | .2 | 1 | .12 | 0 |
| Ambient | .04 | 0 | 1.04 | 0 | .02 |
| Legacy Classics profile | .06 | -.3 | 1.01 | .08 | 0 |
| Dynamic signal | .04 | 0 | 1.02 | 0 | 0 |
| Dense signal | .03 | -.2 | 1 | 0 | 0 |
| Center-focused signal | .04 | 0 | 1 | .04 | 0 |
| Wide signal | .04 | 0 | 1 | 0 | 0 |
| Unclassified | .06 | .2 | 1.01 | .02 | 0 |

Bass, vocal and air are normalized native controls, not dB. These recipes are conservative preferences, not a guarantee of better sound for every recording or headphone.

Restoring automatic processing from a manually chosen acoustic IR disables that custom environment, so it does not remain hidden behind an automatic-status label. Device/headphone calibration is preserved. The automatic-room preference is preserved.

Outdated asynchronous preset results cannot replace newer selections or manual edits. A failed update leaves a conservative Manual Override status with the requested pill retained for retry. Errors can be dismissed and no longer cover the mobile status control.

## Verification

Browser integration tests compare every recipe parameter with the acknowledged engine settings, not just the badge text. They cover category/pill independence, no-pill defaults, manual restoration, raw-bypass priority, failed/pending updates, migration, persistence, and long combined labels at 320x640, 360x800 and 800x360.

Existing expanded-player artwork/control geometry, landscape layout, lyrics/queue placement, and expansion-motion tests remain in the regression set. No expanded-player layout structure was changed.

Production build, browser state/layout/motion regressions and production offline DSP tests passed. On the S25 Ultra, the displayed Film / Soundtrack category agreed with every corresponding native DSP parameter; verification did not change playback or volume.
