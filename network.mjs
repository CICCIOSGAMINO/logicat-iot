// Utility to get Network Interaface details
import { networkInterfaces } from 'os'
import publicIp from 'public-ip'

// ---------------------------------------------- NETWORK -----------------------------------------
/**
  * Filter from networkInterfaces the external IPv4 of the Active Interface
  *
  * @return { string }   - The IP Address IPv4
  */
export const internalIp4 = () => [].concat.apply([], Object.values(networkInterfaces()))
  .filter(details => details.family === 'IPv4' && !details.internal)
  .pop().address

/**
  * Filter from networkInterfaces the Active with the loopback interface NOT included
  *
  * @return { string }   - Active interface
  */
export const activeIface = () => [].concat.apply([], Object.keys(networkInterfaces()))
  .filter(i => i !== 'lo')
  .pop()

/**
  * Get the public ip on internet IPv4
  *
  * @return { string }   - Return the Public Ipv4 address
  */
export const publicIp4 = async () => {
  return await publicIp.v4()
}
