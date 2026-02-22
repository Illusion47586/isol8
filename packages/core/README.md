# @isol8/core

Core engine for isol8 secure code execution.

> **Note**: The `isol8` package is deprecated. Use `@isol8/core` instead.

For full documentation, usage examples, and contribution guidelines, see the main [isol8 README](https://github.com/Illusion47586/isol8/blob/main/README.md).

## Installation

```bash
npm install @isol8/core
```

## Quick Start

```typescript
import { DockerIsol8 } from "@isol8/core";

const engine = new DockerIsol8();
await engine.start();

const result = await engine.execute({
  code: "print('Hello from isol8!')",
  runtime: "python",
});

console.log(result.stdout); // "Hello from isol8!\n"

await engine.stop();
```

## API

See [Library Documentation](https://isol8.dev/docs/library) for full API usage and [isol8 README](https://github.com/Illusion47586/isol8/blob/main/README.md) for project-wide details.

## License

MIT - See [LICENSE](https://github.com/Illusion47586/isol8/blob/main/LICENSE)
