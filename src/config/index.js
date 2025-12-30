/*
  Configuration for BCH Facilitator service
*/

import * as url from 'url'
import { readFileSync } from 'fs'
import dotenv from 'dotenv'

// Load environment variables before accessing process.env
dotenv.config()

const __dirname = url.fileURLToPath(new URL('.', import.meta.url))
const pkgInfo = JSON.parse(readFileSync(`${__dirname.toString()}/../../package.json`))

const version = pkgInfo.version

export default {
  // Server port
  port: process.env.PORT || 4345,

  // Environment
  env: process.env.NODE_ENV || 'development',

  // Logging level
  logLevel: process.env.LOG_LEVEL || 'info',

  // Version
  version,

  // Resource Server BCH address. This is the address that receives payments.
  serverBchAddress: process.env.SERVER_BCH_ADDRESS || 'bitcoincash:qqlrzp23w08434twmvr4fxw672whkjy0py26r63g3d',

  // BCH Infrastructure Information
  // consumer-api = ipfs-bch-wallet-service, rest-api = bch-api
  apiType: process.env.API_TYPE || 'consumer-api',
  // Free API servers here: https://consumers.psfoundation.info/consumers.json
  bchServerUrl: process.env.BCH_SERVER_URL || 'http://free-bch.fullstack.cash',
  // Bearer token for the BCH infrastructure
  bearerToken: process.env.BEARER_TOKEN || ''
}
