GW Logicat 
==========
[TOC]

<!-- ## Unreleased -->
<!-- Add new, unreleased items here. -->

## v0.1.0 [25-03-2020]
- `build`
  - Beta

## Intro 
This is a IoT gateway, data are gather from the field and sent to GCP ecosystem, Firebase real-time database, Firestore, GCP Pub/Sub pattern, GCP Cloud Functions, BigQuery are involved! 

## Getting Start 
The OS in charge is Ubuntu Core, starting from 04/2020 with the Ubuntu Core 20-04 LTS version, power on and configure the Ubuntu Core system with the basic network configurations and login in the right Ubuntu ONE account. 

When Ubuntu Core is up and running, install the module with snap: 

```bash
snap install .... 
```
## DEVICE_SERIAL 
Device is unique identify with this env, need to be OS unique, so for example can be the snap serial or the machine identifier: 

**Snap Serial** 
Snap serial is a unique snapd indentifier: 
```bash
snap model | grep serial 
```

**Machine Identifier**
Machine identifier is base on systemd can identify in unique mode a machine of the Linux world:

```bash
# systemd machine identifier - Unique ansd stable Machine Identifier 
cat /etc/machine-id 
```