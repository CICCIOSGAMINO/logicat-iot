import Redis from 'ioredis'

// Redis vars 
const KEY_IOT_LIST = 'iot:list:key'
const KEY_LOG_ZSET = 'log:zset:key'
const KEY_ERROR_ZSET = 'error:zset:key'
const KEY_CONF = 'conf:string:key'

const MAX_LOG_MSG = 1000
const MAX_ERR_MSG = 1000

const redis = new Redis()
// const redis = new Redis('/tmp/redis.sock')   // UNIX socket 


/**
 * Insert item at hte right of the list (eg. FIFO queue)
 * 
 * @argument msg String - String to store in redis db 
 * @returns { Promise<number> } - Promise (resolve with a number)
 */
export const redisAddIotItem = (msg) => {
  return redis.rpush(KEY_IOT_LIST, JSON.stringify(msg))
}


/**
 * Get a bath of items from the list 
 * 
 * @returns { Promise<[]> } - Promise with an array with batch of items 
 */
export const redisGetIotBatchItems = (batchItems) => {
  return new Promise((resolve, reject) => {
    redis.multi()
    .lrange(KEY_IOT_LIST, 0, batchItems - 1)
    .ltrim(KEY_IOT_LIST, batchItems, -1)
    .exec()
    .then(results => {
      resolve(results[0][1])
    })
    .catch(err => {
      reject(err)
    })
  })
}

/**
 * Get all the items from the list 
 * 
 * @returns { Promise<[]> } - Promise with array with all iot items 
 */
export const redisGetIotAllItems = () => {
  return new Promise((resolve, reject) => {
    redis.multi()
    .lrange(KEY_IOT_LIST, 0, -1)
    .del(KEY_IOT_LIST)
    .exec()
    .then(results => {
      resolve(results[0][1])
    })
    .catch(err => {
      reject(err)
    })
  })
}

/**
 * Get the count of items in iotdata zset 
 * 
 * @returns { Promise<number> } - Promise (resolve with a number)
 */
export const redisCountIotItems = () => redis.llen(KEY_IOT_LIST)

/**
 * Delete all the iot items from the list 
 * 
 * @returns { Promise<number> } - Promise (resolve with a number)
 */
const _deleteIotItems = () => redis.del(KEY_IOT_LIST)

/**
 * Save the configuration String item 
 * 
 * @param { string } config
 * @returns { Promise<string> } - Promise (resolve with a number)
 */
export const redisSaveConfiguration = (config) => redis.set(KEY_CONF, JSON.stringify(config))

/**
 * Get the configuration 
 * 
 * @returns { Promise<Object> } - Promise with the configuration 
 */
export const redisGetConfiguration = () => {

  return new Promise((resolve, reject) => {

    redis.get(KEY_CONF)
    .then(result => {
      try {
        // Redis retrieve and JSON.parse OK 
        const jsonResult = JSON.parse(result)
        resolve(jsonResult)
      } catch(e) {
        // Exception in JSON.parse 
        reject(e)
      }
    })
    .catch(err => {
      // Exception in Redis configuration retrieve 
      reject(err)
    })
  })
}

/**
 * Cleaning the key into a zrange window (eg. top range n items)
 * 
 * @param { string } zsetKey - Redis key to access a zset 
 * @param { number } itemsToAdd - Num of items you should add 
 * @param { number } maxWindowSize - Max Window size of top items to hold 
 * @returns { Promise<number> } Promise (resolve with a number)
 */
const _remInWindow = (zsetKey, itemsToAdd, maxWindowSize) => {

  return new Promise((resolve, reject) => {
    redis.zcount(zsetKey, '-inf', '+inf')
    .then(size => {
      // handle the size 
      if (size + itemsToAdd < maxWindowSize) {
        resolve(0)
      } else {
        // too items need to remove some of them 
        const sizeToTrim = (size + itemsToAdd) - maxWindowSize
        redis.zremrangebyrank(zsetKey, 0, sizeToTrim)
        resolve(1)
      }
    })
    .catch(err => {
      reject(err)
    })
  })

}

/**
 * Function to add item in zset with fixed window 
 * 
 * @param { string } msg - message item to store into zset 
 * @param { string } zset KEY_IOT_LIST | KEY_LOG_ZSET - zset to add items 
 * @param { number } maxWindow max number of items into the zset 
 * @returns { Promise< string | number > } - Promise (resolve with a number)
 */
const addItemToZsetWithWindow = (msg, zset, maxWindow) => {
  // score is the time in millis 
  const t = new Date().getTime()
  return new Promise((resolve, reject) => {
    _remInWindow(zset, 1, maxWindow)
    .then(result => {
      return redis.zadd(zset, t, msg)
    })
    .then(result => {
      resolve(result)
    })
    .catch(err => {
      reject(err)
    })
  }) 
}
/**
 * Add item to the log list (fixed length) the items are only add
 * connect to redis instance to check the log messages 
 * 
 * @param { string } msg - log message to store 
 * @returns { Promise< string | number > } - Promise (resolve with a number)
 */
export const redisAddLog = (msg) =>
  addItemToZsetWithWindow(msg, KEY_LOG_ZSET, MAX_LOG_MSG)

 /**
 * Add item to the error list (fixed length) the items are only add
 * connect to redis instance to check the log messages 
 * 
 * @param { string } err - error message to store 
 * @returns { Promise< string | number > } - Promise (resolve with a number)
 */
export const redisAddErr = (err) => 
  addItemToZsetWithWindow(err, KEY_ERROR_ZSET, MAX_ERR_MSG)

