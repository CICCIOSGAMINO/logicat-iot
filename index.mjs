#!/usr/bin/env node
'use strict'
// ip, interface handling
import {
  internalIp4,
  activeIface,
  publicIp4
} from './network.mjs'
// DNS Connection module
import {
  connectionEmitter,
  startConnectionChecking,
  isInternetAvailable
} from './connection.mjs'
// Ids Validator
import {
  checkId
} from './validator.mjs'

// ---------------------------------------------- Redis -------------------------------------------
// Redis in-cache db is responsable to store/retrive iot items and offline/online configurations 
import {
  redisSaveConfiguration,
  redisGetConfiguration,
  redisAddIotItem,
  redisCountIotItems,
  redisGetIotBatchItems,
  redisAddLog,
  redisAddErr
} from './redis.mjs'

// Firebase module
import firebase from 'firebase'

// Google Cloud PubSub
import pubsub from '@google-cloud/pubsub'
// net (TCP Server)
import { Server } from 'net'
const server = new Server()

// Creates a client; cache this for further use
const pubSubClient = new pubsub.PubSub()
const publisherClient = new pubsub.v1.PublisherClient({})

// Google Pub/Sub formatted Topic projects/[project_id]/topics/[topic_name]
// const formattedTopic = publisherClient.topicPath(projectId, topicName);
let formattedTopic, batchPublisher
// maxMessages and maxWaitTime [sec]
const maxMessages = 1
const maxWaitTime = 60

// Device Serial (Unique by OS eg Snap serial, hardware serial ...)
const deviceId = process.env['DEVICE_SERIAL'] || ''

// Default PORT and INTERVAL
const DEFAULT_PORT = 8888
const DEFAULT_INTERVAL = 36000
const DEFAULT_DEVICES_IDS = []
// Array with ids list of devices can push messages
let devicesIds = DEFAULT_DEVICES_IDS

// -------------------------------------------- Connection ----------------------------------------
// Cheking the connection status with polling Google DNS, handled with the connectionEmitter!

connectionEmitter.on('connected', (data) => {
  // Timing + Connection OK
  log(`@SCHEDULED (Online): ${data.interval}sec`)

  // Init services
  initPubSub()
  fireLogin(email, passw)

  // check Firebase Auth and PubSub
  if (fireUser !== undefined && batchPublisher !== undefined) {
  // logged, push items of zero is returned
    redisCountIotItems()
      .then(count => {
      // if no iot items to push return
        if (count > 0) {
          redisGetIotBatchItems(100)
            .then(items => {
              items.forEach(i => {
                // console.log(`@I (${typeof i}): ${i}`)
                // publish the messages
                publishBatchedMessages(i)
                  .then(messageId => {
                    log(`@MSG (Published): ${messageId}`)
                  })
                  .catch(err => {
                    // ERROR in Publish - CONSOLE
                    log(`@ERROR (PUB-ITEM): ${err}`)
                  })
              })
            })
            // catch on redisCountIotItems
            .catch(err => {
              console.log(`@ERROR (REDIS_ITEMS) Get IoT items: ${err}`)
            })
        } // end if count > 0
      })
      .catch(err => {
        log(`@ERROR (REDIS_COUNT) Count Iot items: ${err}`)
      })
  }
})

connectionEmitter.on('disconnected', (data) => {
  // Timing but NOT Online
  log(`@SCHEDULED (Offline): ${data.interval}sec`)
})

// If Offline && Configuration present active LOCAL TCP services
isInternetAvailable()
  .then(_ => {
    // Internet Available - Fetch from Firebase the config
    fireLogin(email, passw)
  })
  .catch(_ => {
    // Internet NOT Available - Fetch from Redis db if Config present
    redisGetConfiguration()
      .then(configObj => {
        // Security check on port and interval
        const port = Number(configObj.port) || DEFAULT_PORT
        const interval = Number(configObj.interval) || DEFAULT_INTERVAL
        devicesIds = configObj.ids || DEFAULT_DEVICES_IDS
        // Init the TCP Server
        initTCPServer(port)

        // Init scheduler with Offline config
        startConnectionChecking(interval)
      })
      .catch(err => {
        log(`@ERROR (Redis): Offline Configurations ${err}`)
      }) // End Catch Redis Conf
  }) // End Catch isInternetAvailable

// --------------------------------------------- Firebase -----------------------------------------
// Real-time db is the service to handle the device's configuration via cloud.(topics, timing, etc)
let fireUser

// Load ENV VARS for Firebase
const fireConf = JSON.parse(process.env['FIREBASE_CONF'])
const email = process.env['FIREBASE_EMAIL'] || ''
const passw = process.env['FIREBASE_PSW'] || ''

// Firebase Init
const app = firebase.initializeApp(fireConf)
const auth = app.auth()
const db = app.database()

// Firebase References
const fireStatusRef = db.ref('.info/connected')
const refConfig = db.ref(`/devices/${deviceId}/config`)
const deviceStatusRef = db.ref(`/devices/${deviceId}/status`)
const errorRef = db.ref(`/devices/${deviceId}/errors`)

/**
 * Firebase signin - Try to login to Firebase Cloud Infrastructure
 *
 */
const fireLogin = (email, passw) => {
  // check auth
  if (fireUser !== undefined) return

  // auth in firebase
  auth.signInWithEmailAndPassword(email, passw)
    .catch(err => {
      // ERROR in LOGIN - CONSOLE
      log(`@ERROR (Firebase_Auth): ${err.message}`, 1)
    })
}

// Listening for Firebase Auth
auth.onAuthStateChanged(user => {
  if (user) {
    // LOGGED - CONSOLE
    fireUser = user.uid
    log(`@USER (Logged): ${user.uid}`)

    startStatusListening()
    startListenerConfig()
  } else {
    fireUser = undefined
  }
})

/**
  * Start the Listening for Firebase Config object needed for start PubSub and TCP
  *
  */
const startListenerConfig = () => {
  // create the firebase configChanged event handler
  const configChanged = function (snap) {
    // save the Firebase configuration object in Redis
    if (snap.val()) {
      redisSaveConfiguration(snap.val())
    }

    redisGetConfiguration()
      .then(configObj => {
        const port = Number(configObj.port) || DEFAULT_PORT
        const interval = Number(configObj.interval) || DEFAULT_INTERVAL
        devicesIds = configObj.ids || DEFAULT_DEVICES_IDS

        formattedTopic = configObj.topic || ''
        log(`@MSG (Config): Port: ${port} Interval: ${interval} Topic: ${formattedTopic} `)

        // Init the Timing
        startConnectionChecking(interval)

        // Init the PubSub Service
        initPubSub()
          .catch(error => {
            // ERROR initPubSub - CONSOLE
            log(`@ERROR (PubSub Init): ${error}`, 2)
          })
        // Init the TCP Server
        initTCPServer(port)
          .catch(error => {
            // ERROR initTCPServer - CONSOLE
            log(`@ERROR (TCP Init): ${error}`, 2)
          })
      })
      .catch(err => {
        // catch the JSON.parse or Redis get exceptions 
        log(`@ERROR (JSON Parser or Redis Exec): ${err}`, 2)
      })
  }

  const errorConfig = function (error) {
    // ERROR in CONFIG - CONSOLE
    // 1) Bad DEVICE_SERIAL
    // 2) No Connection
    log(`@ERROR (Firebase_Conf): ${error}`, 2)
  }

  refConfig.on('value', configChanged, errorConfig)
}

/**
  * Firebase ONLINE/OFFLINE status
  *
  */
const startStatusListening = () => {
  // status of firebase connection
  fireStatusRef.on('value', async snap => {
    // snap.val()  true/false
    if (snap.val()) {
      deviceStatusRef.set({
        t: firebase.database.ServerValue.TIMESTAMP,
        iface: activeIface(),
        ip: internalIp4(),
        public: await publicIp4()
      })
    } else {
      deviceStatusRef.onDisconnect().set({
        t: firebase.database.ServerValue.TIMESTAMP,
        iface: '',
        ip: '',
        public: ''
      })
    }
  })
}

// -------------------------------------------- PubSub --------------------------------------------
// Google Cloud PubSub is the connector with the cloud, topics are the highway to drive the data!

/**
  * Init the Google Cloud PubSub service with the topic received by Config obj
  *
  */
const initPubSub = async () => {
  // check the publisher
  if (batchPublisher !== undefined) return

  // Init the Google PubSub service and test topic permission
  const pushMsgPermission = ['pubsub.topics.publish']
  pubSubClient
    .topic(formattedTopic)
    .iam.testPermissions(pushMsgPermission)
    .then(p => {
      // Permission OK (can push on this topic )
      // Init the batchPublisher
      batchPublisher = pubSubClient.topic(formattedTopic, {
        batching: {
          maxMessages: maxMessages,
          maxMilliseconds: maxWaitTime * 1000
        }
      })

      // Register the event to status device - Every time initPubSub send this formatted service message
      // This is very useful to test the PubSub / Cloud Function service
      publishBatchedMessages(`
        {"id":"${deviceId.replace(/-/g, '_')}", "t":${Math.floor(Date.now() / 1000)}, "msg": "topic:${formattedTopic}"}
      `).then(messageId => {
        log(`@SERVICE (INIT_PUBSUB): ${messageId}`)
      })
    })
    .catch(err => {
      log(`@ERROR (PubSub): Init Service: ${err}`, 1)
    })
}

/**
 * Publish to PubSub topic with the retry params set
 *
 * @param { string } msg - JSON formatted message to Publish
 */
const publishWithRetrySettings = async (msg) => {
  const dataBuffer = Buffer.from(msg)
  const messagesElement = {
    data: dataBuffer
  }
  const messages = [messagesElement]
  const request = {
    topic: formattedTopic,
    messages: messages
  }

  // How the publisher handles retryable failures
  const retrySettings = {
    retryCodes: [
      10, // 'ABORTED'
      1, // 'CANCELLED',
      4, // 'DEADLINE_EXCEEDED'
      13, // 'INTERNAL'
      8, // 'RESOURCE_EXHAUSTED'
      14, // 'UNAVAILABLE'
      2 // 'UNKNOWN'
    ],
    backoffSettings: {
      initialRetryDelayMillis: 1000,
      retryDelayMultiplier: 1.3,
      maxRetryDelayMillis: 60000,
      initialRpcTimeoutMillis: 5000,
      rpcTimeoutMultiplier: 1.0,
      maxRpcTimeoutMillis: 600000,
      totalTimeoutMillis: 6000000
    }
  }

  const [response] = await publisherClient.publish(request, {
    retry: retrySettings
  })
  log(`@MSG (Published): ${response.messageIds}`)
}

/**
 * Publish to PubSub topic in batch mode
 *
 * @param {String} msg - JSON formatted message to Publish or [{...}, {...}, ...] for messages
 */
const publishBatchedMessages = (msg) => {
  const dataBuffer = Buffer.from(`${msg}`)
  return batchPublisher.publish(dataBuffer)
}

// ----------------------------------------------- Log --------------------------------------------
// The log, errors and exception can be logged into firebase(connected/auth), redis and console!

/**
 * Function to log messages in console and redis (firebase only for severe errors)
 *
 * @param {string } msg - message to log
 * @param { number } severity - level of severity 0 log, 1 error, 2 error cloud log
 */
const log = (msg, severity = 0) => {
  switch (severity) {
    // 0  console & redis log
    case 0:
      console.log(msg)
      // write in redis log
      redisAddLog(msg)
        .then(_ => 'ok')
        .catch(err => {
          console.log(`@ERROR (Redis) Writing Log: ${err}`)
        })
      break
    // 1 console & redis error log
    case 1:
      console.log(msg)
      // write in redis err
      redisAddErr(msg)
        .then(_ => 'ok')
        .catch(err => {
          console.log(`@ERROR (Redis) Writing Err: ${err}`)
        })
      break
    // 2 console & redis error log & firebase error log
    case 2:
      console.log(msg)
      // write in redis err
      redisAddErr(msg)
        .then(_ => 'ok')
        .catch(err => {
          console.log(`@ERROR (Redis) Writing Err: ${err}`)
        })
      // write in firebase error
      errorRef.set({
        t: firebase.database.ServerValue.TIMESTAMP,
        error: msg
      })
        .catch(err => {
          console.log(`@ERROR (Firebase) Writing Err: ${err}`)
        })
      break
  }
}

// -------------------------------------------- TCP Server ----------------------------------------
// TCP Server is in charge to hadnle the local TCP communication with the devices on the field! 

/**
  * Init the TCP Server configure the port received by Config obj
  *
  * @param {Number} port - TCP Server port
  *
  */
const initTCPServer = async (port) => {
  port = Number(port)
  // close actual server
  server.close()

  // Active and listen on new port
  server.listen(port, () => {
    log(`@SERVER (${port}): Listening`)
  })
}

server.on('connection', (socket) => {
  // Data received from Client
  socket.on('data', (chunk) => {
    // Test is a RIGHT JSON object, only JSON msg can be handled
    try {
      // needed because can't use double quote in ABB Robot sw
      const rightApexChunk = chunk.toString().replace(/'/g, "\"")
      const data = JSON.parse(rightApexChunk, (key, value) => {
        // checking the t field, must contain valid timestamp
        if (key === 't' && value === '') {
          return Math.floor(Date.now() / 1000)
        } else {
          return value
        }
      })

      // Alone iot item in Object form
      if (data.length === undefined) {
        // only one JSON object to store
        if (checkId(data, devicesIds)) {
          redisAddIotItem(data)
            .then(record => {
              // ok
              socket.write('1')
              log(`@RECORD (${record}): ${JSON.stringify(data)}`)
            })
            .catch(err => {
              // error on redis add item
              socket.write('0')
            })
        } else {
          // not correct id of one item
          socket.write('0')
          log('@ERROR Not correct id of one iot item', 1)
        }
      }
      // More than one iot item in Array form
      if (data.length > 0) {
        // check if all ids are correct
        let correct = true
        data.forEach(element => {
          if (!checkId(element, devicesIds)) {
            correct = false
          }
        })

        // if all ids correct add to redis
        if (correct) {
          const promises = []

          data.forEach(element => {
            promises.push(redisAddIotItem(element))
          })

          Promise.all(promises)
            .then(responses => {
              // OK
              socket.write('1')
              log(`@REDIS (Multy Insert): ${responses}`)
            })
            .catch(err => {
              // ERR
              socket.write('0')
              log(`@ERROR (Redis): ${err}`, 1)
            })
        } else {
          // not correct id of one item
          socket.write('0')
          log('@ERROR (Multy ids): Not correct id of one iot item', 1)
        }
      }
    } catch (e) {
      // ERROR in JSON parsing - CONSOLE
      socket.write('0')
      log(`@ERROR (JSON Parsing): ${e}`, 2)
    }
  }) // End Socket.on('data', chunck => .... )

  // Connection
  socket.on('connect', () => {
    console.log(`@SOCKET (Connect): ${socket.remoteAddress}:${socket.remotePort}`)
  })

  // Close
  socket.on('close', () => {
    console.log(`@SOCKET (Close): ${socket.remoteAddress}:${socket.remotePort}`)
  })

  // Client request to END the TCP connection, server END the connection
  socket.on('end', () => {
    console.log(`@SOCKET (End): ${socket.remoteAddress}:${socket.remotePort}`)
  })

  // Don't forget to catch error, for your own sake.
  socket.on('error', (err) => {
    // ERROR on Socket - CONSOLE
    log(`@ERROR (Socket): ${err}`, 1)
  })
}) // End server.connection

// ------------------------------------------ Main Process ----------------------------------------
// Main process handling and uncaught exceptions (all exceptions that are not handled in the code )

// warnings
process.on('warning', (warning) => {
  log(`@WARNING (Process): ${warning.name} - ${warning.message}`, 1)
})

// emitted whenever a Promise is rejected and no errors handler is attached
process.on('unhandledRejection', (reason, promise) => {
  log(`@UNHANDLED (Rejection): ${promise} - ${reason}`, 2)
})

// event is emitted before an 'uncaughtException'
process.on('uncaughtException', (err, origin) => {
  log(`@UNCAUGH (Exception): ${origin} - ${err}`, 2)
})
