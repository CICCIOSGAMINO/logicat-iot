GW Logicat 
==========
[TOC]

<!-- ## Unreleased -->
<!-- Add new, unreleased items here. -->
## v1.0.1 [21-05-2020]
  - First release - v1.0.0 logicat-iot first release 

## v0.1.0 [25-03-2020]
  - Beta

## Intro 
Main doc about **logicat-iot** project. This is an iot gateway developeded (v1.0.0 on 20/05/2020) on snap, node.js v13.14.0 where data are gather from the field and sent to GCP ecosystem. Firebase real-time database, Firestore, GCP Pub/Sub pattern, GCP Cloud Functions, BigQuery are involved! Iot device can handle the device data and the field data into separate cloud connections with two different security cahnnels one fot the device status and configuration and the other for client's data. 

## Getting Start 
The OS in charge is Ubuntu Core, starting from 04/2020 with the Ubuntu Core 20-04 LTS version, power on and configure the Ubuntu Core system with the basic network configurations and login in the right Ubuntu ONE account. 

The Github code has a snapcraft.yaml file to build the snap and install on all the Linux architecture you need to run the code. 

## DEVICE_SERIAL 
Device serial is the unique snap serial. The snap serial is an unique id based on snapd installation, indeed snapd installation is based native on OS (eg. Ubuntu and other Linux distro) or by installing snap application. Serial device is the only unique identifier of the device on the Firebase cloud device handler. To provision new device you need the Device serial due to register the new device on the Firebase device management cloud service. 

**Snap Serial**  
```bash
# catch the snap serial from device 
snap model | grep serial 
```

## Cloud Components
Here the components involved: 
+ Google Cloud aervice-accounts
+ Google Cloud Pub/Sub topics
+ Firebase Cloud Functions
+ Firebase Real-time db  (conf, status)
+ Firebase Firestore db  (device info, webapp data)

## Service-Account
The authentication & authorization to push the data to the cloud (PubSub client) is handle with the service-accounts permissions installed on every device. Every client's group of devices have the same service-account json security file copied and linked with an env variable. Here the service-accounts available: 
```bash
gcloud beta iam service-accounts list
> ... 
```

Of course you need to make the env variable PERSISTENT, so create the right file in the **/etc/profile.d** folder: Here an example: 

```bash
# google_application_credentials.sh  file  /etc/profile.d 
export GOOGLE_APPLICATION_CREDENTIALS="/home/myhome/Keys/keys.json"
```

And load the new env variable without re-loggin: 

```bash
source /etc/profile.d/google_application_credentials.sh
``` 

In Ubunto Core you can set the **/etc/environment** file to add the env you need to run the app.

## env 
Here the list of env needed to authenticate to the Cloud services: 

DEVICE_SERIAL
GOOGLE_APPLICATION_CREDENTIALS
FIREBASE_CONF
FIREBASE_PSW
FIREBASE_EMAIL

## JSON Messages 
The fields PLC, Robots, Sensors and all other TCP comm can ship data to iot gateway. The device do a control on JSON message before push to the cloud, here the steps to validate the message: 

+ JSON Formatted message 
+ id field, a valid sending device id
+ t field, in each message the t field needed (empty string or valid timestamp)

## TODO 

