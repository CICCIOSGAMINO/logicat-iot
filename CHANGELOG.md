# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.4.1] - 2020-01-07
### Change
  - Minor code style fix

## [1.4.0] - 2020-10-06
### Change 
  - Fix Error: Retry total timeout exceeded before any response was received in PubSub 
  - Raise maxWaitTime from 10 to 60 
  - Update the @google-cloud/pubsub to ^2.5.0 
  - Update the firebase to ^7.22.1
  - Update the ioredis to ^4.17.3
  - Update Node.js to v14.13.0

## [1.3.0] - 2020-07-08
### Changed
  - Fix the table.serial-id - to _ pattern 

## [1.2.0] - 2020-06-15
### Changed
  - Fix the publishBatchedMessages

## [1.1.0] - 2020-0-12
### Added
  - Control to undefined to fireUser and batchPublisher
  - @ERROR messages  
  - deviceId with _ for BigQuery table 

### Changed 
  - Redis v6.0.5

## [1.0.8] - 2020-06-03
### Added 
  - logs details into in-cache db 
  - errors details into in-cache db
  - more details on init device msg

### Changed 
  - snap - remove usless home permission  

## [1.0.7] - 2020-05-25
### Added 
  - Bootstrap the Project by [@cicciosgamino](https://github.com/CICCIOSGAMINO)