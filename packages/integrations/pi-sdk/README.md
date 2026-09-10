# Pi SDK event retention

The session retains screenshot evidence up to 8 MiB per image and 64 MiB across
one run. It checks the encoded size before allocating a decoded buffer. Images
within those limits remain usable screenshot bytes; images exceeding either
limit become an explicit text omission marker in the retained trajectory. The
marker contains no image payload for downstream adapters to decode again.

These limits apply to the harness's retained evidence. They do not change the
tool result the model receives or bound Pi's own upstream message storage.
Whitespace-heavy or otherwise noncanonical base64 may be rejected conservatively.

Normal completed-event logs are debug detail. Tool/provider failures stay visible
at level 1; log summaries redact credentials before applying their text limit.
