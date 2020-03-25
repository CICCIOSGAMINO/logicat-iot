#!/usr/bin/env node

'use strict';
// net (TCP Server)
const net = require('net');
const server = new net.Server();

// fire.js - Prototype of  main.js 
const { internalIp4, activeIface, publicIp4 } = require('./utils.cjs');

// Firebase module 
const firebase = require('firebase/app');
require("firebase/auth");
require("firebase/database");

// Google Cloud PubSub  
const {PubSub} = require('@google-cloud/pubsub');
// Creates a client; cache this for further use
const pubSubClient = new PubSub();

// Creates a publisher client 
const {v1} = require('@google-cloud/pubsub');
const publisherClient = new v1.PublisherClient({});

// Google Pub/Sub formatted Topic projects/[project_id]/topics/[topic_name]
// const formattedTopic = publisherClient.topicPath(projectId, topicName);
let formattedTopic;
let batchPublisher;
// maxMessages and maxWaitTime [sec]
const maxMessages = 10;
const maxWaitTime = 60;

// Retrive the Device Serial (Unique by OS eg Snap serial, hardware serial ...)
const deviceId = process.env['DEVICE_SERIAL'] || '';

// ----------------------------------------- Firebase -----------------------------------
// Load ENV VARS for Firebase
const fireConf = JSON.parse(process.env['FIREBASE_CONF']);
const email = process.env['FIREBASE_EMAIL'] || '';
const passw = process.env['FIREBASE_PSW'] || '';
 
// Firebase Init 
const app = firebase.initializeApp(fireConf);
const auth = app.auth();
const db = app.database();

// Firebase References 
const fireStatusRef = db.ref('.info/connected');
const refConfig = db.ref(`/devices/${deviceId}/config`);
const deviceStatusRef = db.ref(`/devices/${deviceId}/status`);
const errorRef = db.ref(`/devices/${deviceId}/errors`);

// Firebase Auth the User 
auth.signInWithEmailAndPassword(email, passw)
    .catch(err => {
      // ERROR in LOGIN - CONSOLE 
      console.log(`@ERROR(FIREBASE_AUTH): ${err.message}`);
    }); 

auth.onAuthStateChanged(user => {
  if(user) {
    // LOGGED - CONSOLE 
    console.log(`@USER: ${ user.uid }`);

      startStatusListening();
      startListenerConfig();

  }
}); 

/**
  * Start the Listening for Firebase Config object needed for start PubSub and TCP
  * @return { }
  */
function startListenerConfig() {

  // create the firebase configChanged event handler 
  const configChanged = function(snap) {

    const configObj = snap.val();
    const port = Number(configObj.port) || 8888;
    formattedTopic = configObj.topic || "";
    console.log(`@CONFG: Port: ${port} Topic: ${formattedTopic} `);

    // Init the PubSub Service 
    initPubSub()
      .catch(error => {
        // ERROR initPubSub - CONSOLE 
        const msg = `@ERROR(PubSub): ${error}`;
        console.log(msg);
        logError(msg);
      });
    // Init the TCP Server 
    initTCPServer(port)
      .catch(error => {
        // ERROR initTCPServer - CONSOLE 
        const msg = `@ERROR(TCP): ${error}`;
        console.log(msg);
        logError(msg);
      })
  }

  const errorConfig = function(error) {
    // ERROR in CONFIG - CONSOLE 
    // 1) Bad DEVICE_SERIAL 
    // 2) No Connection 
    const msg = `@ERROR(FIREBASE_CONF): ${error}`;
    console.log(msg);
    logError(msg);
  }

  refConfig.on('value',configChanged, errorConfig);
}


/**
  * Start the status ONLINE/OFFLINE device listening on firebase (only after firebase login)
  * @return { }
  */
function startStatusListening() {

  // Listening for the status of firebase connection 
  fireStatusRef.on(`value`, async snap => {
    // snap.val()  true/false  
    if(snap.val()){
      deviceStatusRef.set({
        t: firebase.database.ServerValue.TIMESTAMP,
        iface: activeIface(),
        ip: internalIp4(),
        public: await publicIp4()
      });
    } else {
      deviceStatusRef.onDisconnect().set({
        t: firebase.database.ServerValue.TIMESTAMP,
        iface: '',
        ip: '',
        public: ''
      });
    }
  });
};

/**
 * If connected log the main error on Firebase db 
 * @param {String} msg - Error message to log in the Firebase db 
 * @return {Promise} 
 */
function logError(err) {
  return errorRef.set({
    t: firebase.database.ServerValue.TIMESTAMP,
    error: err
  });
};

// -------------------------------------------- PubSub -------------------------------------------

/**
  * Init the Google Cloud PubSub service with the topic received by Config obj
  * @return { }
  */
async function initPubSub() {

    // Init the Google PubSub service and test topic permission 
    const pushMsgPermission = ['pubsub.topics.publish'];
    const permission = await pubSubClient
      .topic(formattedTopic)
      .iam.testPermissions(pushMsgPermission);

      
    // Init the batchPublisher 
    batchPublisher = pubSubClient.topic(formattedTopic, {
      batching: {
        maxMessages: maxMessages,
        maxMilliseconds: maxWaitTime * 1000
      }
    });

    // Send Msg every time PubSub settings change 
    publishBatchedMessages(`
        {"id":"0", "t":${Math.floor(Date.now() / 1000)}, "msg": "topic:${formattedTopic}"}
    `)
};

/**
 * Publish to PubSub topic with the retry params set 
 * 
 * @param {String} msg - JSON formatted message to Publish 
 */
async function publishWithRetrySettings(msg) {

  const dataBuffer = Buffer.from(msg);
  const messagesElement = {
    data: dataBuffer,
  };
  const messages = [messagesElement];
  const request = {
    topic: formattedTopic,
    messages: messages
  };

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
  };

  const [response] = await publisherClient.publish(request, {
      retry: retrySettings,
    });

  console.log(`@MSG: ${response.messageIds}`)

}

/**
 * Publish to PubSub topic in bath mode
 * 
 * @param {String} msg - JSON formatted message to Publish or [{...}, {...}, ...] for messages
 */
async function publishBatchedMessages(msg) {
  const dataBuffer = Buffer.from(msg);

  const messageId = await batchPublisher.publish(dataBuffer);
  // const messageId = await batchPublisher.publishJSON(dataBuffer);
  console.log(`@MSG: ${messageId} Published!`);

}

// ------------------------------------------- TCP Server ----------------------------------------

/**
  * Init the TCP Server configure the port received by Config obj
  * @param {Number} port - TCP Server port 
  * @return { }
  */
 async function initTCPServer(port) {
    port = Number(port);

    // close actual server 
    server.close();

    // Active and listen on new port 
    server.listen(port, () => {
      console.log(`@SERVER: Active(port:${port})`);
    });
 };

 server.on('connection', (socket) => {

   // TCP connection established 
   socket.write(`CONNECTED`);

   //Data received from Client 
   socket.on('data', (chunk) => {

    // Test is a RIGHT JSON object, ready to Dataflow template, and set right time 
    try {

      // needed because can't use double quote in ABB/PLC software 
      const rightApexChunk = chunk.toString().replace(/'/g, "\"");
      const data = JSON.parse(rightApexChunk, (key, value) => {
        if(key === "t" && value === "") {
          // TODO - Check the TIMESTAMP value for BigQuery field 
          return Math.floor(Date.now() / 1000)
        } else {
          return value;
        }
      });
      console.log(`@DATA(${socket.remoteAddress}:${socket.remotePort}): ${JSON.stringify(data)}`);

      publishBatchedMessages(JSON.stringify(data))
        .then(() => {
          socket.write('OK');
        })
        .catch(error => {
          // ERROR in Publish - CONSOLE
          const msg = `@ERROR(PUBLISH): ${error}`;
          console.log(msg);
          logError(msg);
          socket.write('ERROR-PUBSUB');
        })

    } catch(e) {
      // ERROR in JSON parsing - CONSOLE 
      const msg = `@ERROR(JSON): ${e}`;
      console.log(msg);
      logError(msg);
      socket.write('ERROR-JSON)');
    }

   });

  // Client request to END the TCP connection, server END the connection
  socket.on('end', () => {
    console.log(`@CLOSING_CONNECTION: ${socket.remoteAddress}:${socket.remotePort}`);
  });

  // Don't forget to catch error, for your own sake.
  socket.on('error', (err) => {
    // ERROR on Socket - CONSOLE 
    const msg = `@ERROR(SOCKET): ${socket.remoteAddress}:${socket.remotePort} - ${err}`;
    console.log(msg);
    logError(msg);
  })
 });

 // -----------------------------------------------------------------------------------------------
