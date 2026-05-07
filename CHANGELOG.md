# Changelog

All notable changes to this project will be documented in this file.

This project aims to follow [Semantic Versioning](https://semver.org/). Breaking changes include incompatible changes to command names, required arguments, JSON output contracts, structured error envelopes, stable exit codes, or safety behavior such as `--force` requirements.

## [Unreleased]

## [0.1.1] - 2026-05-07

### Fixed

- Fixed CLI startup when installed through package-manager symlinks such as Homebrew and npm global bins.

## [0.1.0] - 2026-05-06

### Added

- Initial Raindrop.io CLI package with `raindrop` binary.
- JSON stdout by default and structured JSON errors on stderr.
- Authentication, profile, config, user, collection, bookmark, tag, highlight, import, export, backup, jobs, feedback, doctor, agent-context, raw API, completion, and update command surfaces.
- Safety guard requiring `--force` for destructive operations.
- Mock-based test suite and CI workflows.
