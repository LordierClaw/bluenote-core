# Changelog

## 0.4.0

- Prepare the extracted headless core package for the BlueNote 0.4.0 release line.
- Keep the public root export and built `dist/` artifacts available for reproducible Git tag consumption by `bluenote-term`.

## 0.1.1

- Include built `dist/` artifacts in the Git tag so `bluenote-term` can consume the package through a reproducible Git dependency before npm publishing.

## 0.1.0

- Initial extraction of the headless BlueNote core package from `bluenote-term`.
- Preserves core note, storage, search, domain, config, and AI behavior without terminal UI or CLI code.
