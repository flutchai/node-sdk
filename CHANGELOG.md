# Changelog

## [0.3.0] - 2026-01-30

### Added
- `IGraphLogger` interface — decouples `AbstractGraphBuilder` logger from NestJS `Logger`, allowing any compatible logger implementation

### Changed
- `AbstractGraphBuilder.logger` type changed from NestJS `Logger` to `IGraphLogger` interface
- `AbstractGraphBuilder.manifestPath` type changed from `string` to `string | null`
