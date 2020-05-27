#!/usr/bin/env node

'use strict'
// net (TCP Server)
import { Server } from 'net'
const server = new Server()

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

// Creates a client; cache this for further use
const pubSubClient = new pubsub.PubSub()
const publisherClient = new pubsub.v1.PublisherClient({})


// Google Pub/Sub formatted Topic projects/[project_id]/topics/[topic_name]
// const formattedTopic = publisherClient.topicPath(projectId, topicName);
let formattedTopic, batchPublisher
// maxMessages and maxWaitTime [sec]
const maxMessages = 1
const maxWaitTime = 10

// Device Serial (Unique by OS eg Snap serial, hardware serial ...)
const deviceId = process.env['DEVICE_SERIAL'] || ''

// Default PORT and INTERVAL 
const DEFAULT_PORT = 8888
const DEFAULT_INTERVAL = 36000
const DEFAULT_DEVICES_IDS = []
// Array with ids list of devices can push messages 
let devicesIds = DEFAULT_DEVICES_IDS

// -------------------------------------------- Connection ----------------------------------------
// Cheking the connection status with polling Google DNS, handled with the connectionEmitter! The 
// connectionEmitter is in charge to push data to cloud when triggered by connection and timing!

connectionEmitter.on('connected', (data) => {
  // Timing + Connection OK 
  // TODO 
  log(`@SCHEDULED ONLINE ${data.interval}sec`)
  // Try to Firebase Auth 
  if(fireUser === undefined) {
    // tyr to login 
    fireLogin(email, passw)
  } else {
    // logged, push items of zero is returned  
    redisCountIotItems()
    .then(count => {
      if(count < 1) return 
      // return the items 
      redisGetIotBatchItems(100)
      .then(items => {
        // Array of items push all togheter or forEach them 
        // if (Array.isArray(items)) {
        publishBatchedMessages(items)
        .then(() => 'ok')
        .catch(err => {
          // ERROR in Publish - CONSOLE
          log(`@ERROR (PUB-ITEM): ${err}`)
        })

      })
      // catch on redisCountIotItems
      .catch(err => {
        console.log(`@ERR: ${err}`)
      })

    })
    .catch(err => {

    })

  }

})
connectionEmitter.on('disconnected', (data) => {
  // Timing but NOT Online 
  log(`@SCHEDULED OFFLINE ${data.interval}sec`)
})

// If Offline && Configuration present active LOCAL TCP services
isInternetAvailable()
.then(_ => {
  // Internet Available - Fetch from Firebase the config 
  fireLogin(email, passw)

})
.catch( _ => {
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
    log(`@ERROR - REDIS - Offline COnfigurations`)
  }) // End Catch Redis Conf 
})  // End Catch isInternetAvailable 


// --------------------------------------------- Firebase -----------------------------------------
// Real-time db is the service to handle the device's configuration via cloud.(topics, timing, etc)
let fireUser; 

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
  auth.signInWithEmailAndPassword(email, passw)
  .catch(err => {
    // ERROR in LOGIN - CONSOLE 
    log(`@ERROR (FIREBASE_AUTH): ${err.message}`, 1)
  })
}

// Listening for Firebase Auth 
auth.onAuthStateChanged(user => {
  if(user) {
    // LOGGED - CONSOLE 
    fireUser = user.uid
    log(`@USER: ${ user.uid }`)

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
  const configChanged = function(snap) {
    // save the Firebase configuration object in Redis 
    if (snap.val()) {
      redisSaveConfiguration(snap.val())
    }

    redisGetConfiguration()
    .then(configObj => {
      const port = Number(configObj.port) || DEFAULT_PORT
      const interval = Number(configObj.interval) || DEFAULT_INTERVAL
      devicesIds = configObj.ids || DEFAULT_DEVICES_IDS

      formattedTopic = configObj.topic || ""
      log(`@MSG (CONFIG): Port: ${port} Interval: ${interval} Topic: ${formattedTopic} `)
      
      // Init the Timing 
      startConnectionChecking(interval)

      // Init the PubSub Service 
      initPubSub()
      .catch(error => {
        // ERROR initPubSub - CONSOLE 
        log(`@ERROR (PUBSUB_INIT): ${error}`, 2)
      });
      // Init the TCP Server 
      initTCPServer(port)
      .catch(error => {
        // ERROR initTCPServer - CONSOLE 
        log(`@ERROR (TCP_INIT): ${error}`, 2)
      })

    })
    .catch(err => {
      // catch the JSON.parse or Redis get exceptions 
      log(`@ERROR (JSON_PARSER or REDIS EXC): ${err}`, 2)
    })
  }

  const errorConfig = function(error) {
    // ERROR in CONFIG - CONSOLE 
    // 1) Bad DEVICE_SERIAL 
    // 2) No Connection 
    log(`@ERROR (FIREBASE_CONF): ${error}`, 2)
  }

  refConfig.on('value',configChanged, errorConfig)
}


/**
  * Firebase ONLINE/OFFLINE status 
  * 
  */
const startStatusListening = () => {

  // status of firebase connection 
  fireStatusRef.on(`value`, async snap => {
    // snap.val()  true/false  
    if(snap.val()){
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

      // Send Msg every time PubSub settings change 
      publishBatchedMessages(`
          {"id":"0", "t":${Math.floor(Date.now() / 1000)}, "msg": "topic:${formattedTopic}"}
      `)
    })
    .catch(err => {
      log(`@ERROR (PUBSUB) Init Service: ${err}`)
    })
}

/**
 * Publish to PubSub topic with the retry params set 
 * 
 * @param { string } msg - JSON formatted message to Publish 
 */
const publishWithRetrySettings = async (msg) => {

  const dataBuffer = Buffer.from(msg);
  const messagesElement = {
    data: dataBuffer,
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
      2, // 'UNKNOWN'
    ],
    backoffSettings: {
      initialRetryDelayMillis: 1000,
      retryDelayMultiplier: 1.3,
      maxRetryDelayMillis: 60000,
      initialRpcTimeoutMillis: 5000,
      rpcTimeoutMultiplier: 1.0,
      maxRpcTimeoutMillis: 600000,
      totalTimeoutMillis: 6000000,
    },
  }

  const [response] = await publisherClient.publish(request, {
      retry: retrySettings,
    })

  log(`@MSG (PUB): ${response.messageIds}`)

}

/**
 * Publish to PubSub topic in batch mode
 * 
 * @param {String} msg - JSON formatted message to Publish or [{...}, {...}, ...] for messages
 */
const publishBatchedMessages = async (msg) => {
  const dataBuffer = Buffer.from(msg)

  const messageId = await batchPublisher.publish(dataBuffer);
  // const messageId = await batchPublisher.publishJSON(dataBuffer);
  log(`@MSG (PUB): ${messageId}`)

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

  switch(severity) {
    // 0  console & redis log 
    case 0:
      console.log(msg)
      // write in redis log 
      redisAddLog(msg)
      .then(_ => 'ok')
      .catch(err => {
        console.log(`@ERROR (REDIS) Writing Log: ${err}`)
      })
      break
    // 1 console & redis error log 
    case 1:
      console.log(msg)
      // write in redis err 
      redisAddErr(msg)
      .then(_ => 'ok')
      .catch(err => {
        console.log(`@ERROR (REDIS) Writing Err: ${err}`)
      })
      break
    // 2 console & redis error log & firebase error log 
    case 2:
      console.log(msg)
      // write in redis err 
      redisAddErr(msg)
      .then(_ => 'ok')
      .catch(err => {
        console.log(`@ERROR (REDIS) Writing Err: ${err}`)
      })
      // write in firebase error  
      errorRef.set({
        t: firebase.database.ServerValue.TIMESTAMP,
        error: msg
      })
      .catch(err => {
        console.log(`@ERROR (FIREBASE) Writing Err: ${err}`)
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
      log(`@SERVER (${port}): Listening`);
    })
 }

 server.on('connection', (socket) => {

   //Data received from Client 
   socket.on('data', (chunk) => {

    // Test is a RIGHT JSON object, only JSON msg can be handled
    try {

      // needed because can't use double quote in ABB Robot sw
      const rightApexChunk = chunk.toString().replace(/'/g, "\"");
      const data = JSON.parse(rightApexChunk, (key, value) => {
        // checking the t field, must contain valid timestamp 
        if (key === "t" && value === "") { 
          return Math.floor(Date.now() / 1000)
        } else {
          return value
        }
      })

      // Alone iot item in Object form  
      if (data.length == undefined) {
        // only one JSON object to store 
        if (checkId(data, devicesIds)) {
          redisAddIotItem(data)
          .then(record => {
            // ok 
            socket.write("1")
            log(`@RECORD (${record}): ${JSON.stringify(data)}`)
          })
          .catch(err => {
            // error on redis add item 
            socket.write("0")
          })
        } else {
          // not correct id of one item
          socket.write("0")
          log(`@ERRORNot correct id of one iot item`, 1)
        }
      } 
      
      // More than one iot item in Array form 
      if (data.length > 0) {
        // check if all ids are correct 
        let correct = true
        data.forEach(element => {
          if(!checkId(element, devicesIds)) {
            correct = false
          }
        })

        // if all ids correct add to redis 
        if(correct) {
          const promises = []

          data.forEach(element => {
            promises.push(redisAddIotItem(element))
          })

          Promise.all(promises)
          .then(responses => {
            // OK
            socket.write("1")
            log(`@MSGS (MULTY): ${responses}`)
          })
          .catch(err => {
            // ERR
            socket.write("0")
            log(`@ERROR (MULTY): ${err}`, 1)
          })

        } else {
          // not correct id of one item
          socket.write("0")
          log(`@ERROR (MULTY_IDS): Not correct id of one iot item`, 1)
        }

      } 

    } catch(e) {
      // ERROR in JSON parsing - CONSOLE 
      socket.write("0")
      log(`@ERROR (JSON_PARSING): ${e}`, 2)
    }

   })   // End Socket.on('data', chunck => .... )

  // Connection 
  socket.on('connect', () => {
    console.log(`@SOCKET (CONNECT): ${socket.remoteAddress}:${socket.remotePort}`)
  })

  // Close 
  socket.on('close', () => {
    console.log(`@SOCKET (CLOSE): ${socket.remoteAddress}:${socket.remotePort}`)
  })

  // Client request to END the TCP connection, server END the connection 
  socket.on('end', () => {
    console.log(`@SOCKET (END): ${socket.remoteAddress}:${socket.remotePort}`);
  });

  // Don't forget to catch error, for your own sake.
  socket.on('error', (err) => {
    // ERROR on Socket - CONSOLE 
    log(`@ERROR (SOCKET): ${err}`, 1)
  });

 });    // End server.connection 


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
