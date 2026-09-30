---
"cf": patch
---

Fix generated command output paths on Windows

Convert the generator's file URL to a native filesystem path before writing commands. This preserves Windows drive letters and decodes spaces and Unicode directory names instead of passing an encoded URL pathname to Forge.
