# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a code review visualization tool that analyzes Git diffs and displays them with dependency tracking and symbol reference highlighting. Built with Bun, TypeScript, and OXC parser.

## Essential Commands

```bash
# Development
bun dev            # Start dev server with hot reload (port 8081)
bun typecheck      # Run TypeScript type checking
bun lint           # Check linting with Biome
bun lint:fix       # Auto-fix linting issues
bun format         # Format code with Biome

# Production
bun build          # Build for production
bun start          # Run production build

# Git hooks
bun prepare        # Set up Husky pre-commit hooks
```

## Architecture

The codebase follows a service-oriented architecture:

- **Server** (`src/server.ts`): Bun HTTP server handling both API and static file serving
- **GitService** (`src/git.ts`): Encapsulates all Git operations using simple-git
- **OxcSymbolExtractor** (`src/oxc-symbol-extractor.ts`): Extracts TypeScript/JavaScript symbols using OXC parser
- **DependencyAnalyzer** (`src/dependency-analyzer.ts`): Analyzes dependencies and builds file dependency graphs
- **Routes**: Separated into `ApiRoutes` and `StaticRoutes` classes for clean organization

## Key API Endpoints

- `GET /api/projects` - List available test repositories
- `GET /api/project/:projectId/branches` - List branches for a repository
- `GET /api/project/:projectId/compare?base=X&compare=Y` - Get diff analysis between branches

## Development Workflow

1. Test repositories are in `test-repos/` - these are Git submodules used for testing different scenarios
2. The frontend (`public/`) uses vanilla JavaScript with Prism.js for syntax highlighting
3. Symbol references are pre-computed on the backend for performance
4. Files can be ordered by dependencies (topological sort) or alphabetically

## Important Implementation Details

- Uses OXC parser for fast TypeScript/JavaScript parsing
- Caches symbol references for performance (see `symbolReferenceCache` in dependency-analyzer.ts)
- Pre-processes all data on backend to minimize frontend work
- CORS is enabled for API usage by external tools
- Strict Biome linting rules are enforced via pre-commit hooks

## Testing Approach

The project includes multiple test repositories demonstrating different change scenarios:
- `basic-typescript-api`: Simple API changes
- `react-components-library`: React component modifications
- `utility-library-breaking-changes`: Breaking changes in utilities
- `backend-service-refactor`: Service layer refactoring

To test changes, modify code in these repositories and use the web UI to visualize the impact.