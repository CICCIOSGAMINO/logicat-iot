// Some Utils stuff 
const networkInterfaces = require('os').networkInterfaces;
const publicIp = require('public-ip');

// -------------------------------------------- NETWORK ---------------------------------------
/**
  * Filter from networkInterfaces the external IPv4 of the Active Interface 
  * @return { string }   - The IP Address IPv4
  */
exports.internalIp4 = () => [].concat.apply([], Object.values(networkInterfaces()))
  .filter(details => details.family === 'IPv4' && !details.internal)
  .pop().address;

/**
  * Filter from networkInterfaces the Active NON lo interface 
  * @return { string }   - Active NON lo interfaces
  */
exports.activeIface = () => [].concat.apply([],Object.keys(networkInterfaces()))
  .filter(i => i != 'lo')
  .pop();

/**
  * Get the public ip
  * @return { string }   - Return the Public Ipv4 address
  */
 exports.publicIp4 = async () => {
    return await publicIp.v4();
 };
// --------------------------------------------------------------------------------------------