# @isol8/core

Core engine for isol8 secure code execution.

For full documentation, usage examples, and contribution guidelines, see the main [isol8 README](../README.md).

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

See [API Documentation](https://isol8.dev/docs/api) for full API reference.

## License

MIT - See [../LICENSE](../LICENSE)
