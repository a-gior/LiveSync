# LiveSync Tests

## Test Structure

```
test/
├── unit/                    # Fast, isolated unit tests
├── integration/             # Tests with real I/O (SSH, filesystem)
├── e2e/                     # Full VSCode extension tests
├── fixtures/                # Test data and workspaces
└── helpers/                 # Test utilities
```

## Running Tests

```bash
# Unit tests only (fast)
npm run test:unit

# Integration tests (requires VM at 127.0.0.1)
npm run test:integration

# E2E tests (requires VSCode test environment)
npm run test:e2e

# All tests
npm run test:all
```

## VM Requirements

Integration and E2E tests require a VM accessible at:
- Host: 127.0.0.1
- Port: 2222
- User: centos
- Pass: centos

See `test/helpers/vm/config.ts` for configuration.

## Writing Tests

### Unit Tests
- Use `describe` and `it`
- Mock external dependencies
- Test pure logic only

### Integration Tests
- Use `describe` and `it`
- Real SSH/SFTP connections
- Clean up after tests

### E2E Tests
- Use `suite` and `test` (VSCode TDD style)
- Full extension loaded
- Real file operations

## Test Helpers

- `IndexBuilder`: Build test indexes easily
- `ConfigBuilder`: Build test configs
- `RemotePortMock`: Mock remote operations
- `assertDiffEntry`: Assert diff entry properties
