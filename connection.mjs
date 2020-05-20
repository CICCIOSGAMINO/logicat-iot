// Utility to check the Internet connection throught DNS polling 
import { lookupService } from 'dns'
import { EventEmitter } from 'events'

// Min & default updateing time interval (seconds)
const minUpdatingInterval = 5
const defaultUpdatingInterval = 36000

// Google DNS (used to check internet)
const GOOGLE_DNS_SERVER_IP = '8.8.8.8'
const GOOGLE_DNS_SERVER_PORT = 53

let checkConnectionTimer
let interval

class ConnectionEmitter extends EventEmitter {}

export const connectionEmitter = new ConnectionEmitter()

/*
connectionEmitter.on('connected', (data) => {
  // Connected to Internet   data.hostname  data.service 
  ...
})

connectionEmitter.on('disconnected', (data) => {
  // Disconnected from Internet   
  ...
})

connectionEmitter.on('errors', (err) => {
  // Handle Errors with Emitter 
  ...
}) */ 

/**
 * Check Internet Connection is NOT availability
 * 
 * @returns { Promise } connection NOT available 
 */
export const isInternetAvailable = () => {
  return new Promise((resolve, reject) => {
    // dns lookup service on Google DNS Server 
    lookupService(GOOGLE_DNS_SERVER_IP, GOOGLE_DNS_SERVER_PORT,
      (err, hostname, service) => {
        if(err) {
          // NO Internet Available 
          reject('Internet NOT available')
        } else {
          // Internet Available 
          resolve('Internet available')
        }
      })
  })
}

/**
 * service based on Google DNS service to check connection's status 
 */
const connectionLookupService = () => {
  // dns lookup service on Google DNS Server 
  lookupService(GOOGLE_DNS_SERVER_IP, GOOGLE_DNS_SERVER_PORT, 
      (err, hostname, service) => {
    if (err) {
      connectionEmitter.emit('disconnected', {
        interval: interval
      })
    } else {
      connectionEmitter.emit('connected', 
      {
        hostname: hostname, 
        service: service, 
        interval: interval
      })
    }
  })
}

/**
 * Start the connection checking service, no arguments start with default interval
 * 
 * @param { number | null } [ seconds ] - Time Interval in seconds > 1
 */
export const startConnectionChecking = 
  (seconds = defaultUpdatingInterval) => {
  // valid number for seconds in interval check 
  if (typeof seconds === 'number' && 
      seconds >= minUpdatingInterval) {
    const intervalInMillis = seconds * 1000
    clearInterval(checkConnectionTimer)
    checkConnectionTimer = 
      setInterval(connectionLookupService, intervalInMillis)
    interval = seconds
  } else {
    // not valid argument passed 
    connectionEmitter.emit('error', 
      'Not valid time interval value passed, restored default')
      startConnectionChecking(defaultUpdatingInterval)
      interval = defaultUpdatingInterval
  }
}

/**
 * Stop the connection checking service
 */
export const stopConnectionCheking = () => {
  clearInterval(checkConnectionTimer)
}