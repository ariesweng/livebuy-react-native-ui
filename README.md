# livebuy-react-native-ui

The **view-model layer** (headless, zero-pixel) of the Livebuy React Native SDK. Binds the
drop-in overlays (chat / product cards / header) that `livebuy-react-native-reference-ui`
renders. Ships no pixel-rendering code of its own — pure TypeScript view-models.

> **Distribution.** This repository is a **mirror** — a public, organization-owned consumption
> copy synced from the private Livebuy SDK monorepo (`react-native-ui/` package directory). It is
> not the primary development repository; source changes happen upstream and are synced here at
> release time.

> **Part of a three-package chain.** Requires
> [`livebuy-react-native`](https://github.com/ariesweng/livebuy-react-native) (headless core, peer
> dependency). Most integrators also want
> [`livebuy-react-native-reference-ui`](https://github.com/ariesweng/livebuy-react-native-reference-ui)
> on top of this package for the actual drop-in pixel rendering. npm installs are **not
> transitive** — declare each package you need as its own dependency line.

---

## Installation

```json
{
  "dependencies": {
    "livebuy-react-native": "git+https://github.com/ariesweng/livebuy-react-native.git#v2.0.0",
    "livebuy-react-native-ui": "git+https://github.com/ariesweng/livebuy-react-native-ui.git#v1.3.0"
  }
}
```

Then `npm install` (or `yarn` / `pnpm install`). No registry account or `.npmrc` token needed —
these are plain public git dependencies.

> **Why a git dependency and not npm registry?** The SDK is not (yet) published to the public npm
> registry; this mirror repository is the supported remote consumption channel. The tag you pin
> (`#v1.3.0`) corresponds to this package's `package.json` `version` field at release time — the
> channel itself does not hard-code any particular version string.

---

## Getting Started

If you are using the drop-in containers from `livebuy-react-native-reference-ui`, call
`LivebuyUI.install()` once at app startup — without it, drop-in containers render bare data with
no interactive overlays:

```typescript
import { LivebuyUI } from 'livebuy-react-native-ui';

LivebuyUI.install();
```

Teams drawing their own UI (Tier 0/1) typically depend on this package for the view-model layer
without pulling in `livebuy-react-native-reference-ui`. Full contract (61 requirements across
event catalogue, state machine, and component behavior): request the **component-contracts**
document from Livebuy.

---

## Related packages

| Package | Role |
|---|---|
| `livebuy-react-native` | headless core |
| `livebuy-react-native-ui` (this repo) | view-model layer for drop-in overlays |
| `livebuy-react-native-reference-ui` | drop-in turnkey pixel layer |

---

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

---

## License

Copyright © Livebuy. All rights reserved.
