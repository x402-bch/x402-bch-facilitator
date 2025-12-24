/*
  Facilitator use case for BCH payment verification and settlement.

  High level overview:
  - Client submits UTXO information as a proof of payment.
  - Facilitator adds new UTXOs to the Level DB for quick lookup.
  - Client can send any amount in UTXO. Each call is debited against that UTXO
    until the amount is exhausted.
*/

// BCH mainnet CAIP-2 identifier
const BCH_MAINNET_CAIP2 = 'bip122:000000000000000000651ef99cb9fcbe'

/**
 * Normalizes BCH network identifiers to support both v1 ('bch') and v2 (CAIP-2) formats.
 * Only normalizes known BCH networks; returns other networks as-is.
 * @param {string} network - Network identifier (can be 'bch' or CAIP-2 format)
 * @returns {string} Normalized network identifier (BCH mainnet CAIP-2 for BCH networks, original for others)
 */
function normalizeNetwork (network) {
  if (!network) return BCH_MAINNET_CAIP2
  // v1 format
  if (network === 'bch') return BCH_MAINNET_CAIP2
  // v2 CAIP-2 format for BCH mainnet
  if (network === BCH_MAINNET_CAIP2) return BCH_MAINNET_CAIP2
  // v2 CAIP-2 format pattern matching (bip122:* for BCH networks)
  // Only normalize if it's a BCH network (mainnet or testnet)
  if (network.startsWith('bip122:')) {
    // For now, only normalize known BCH networks
    // Return as-is for other bip122 networks (they might be other Bitcoin forks)
    return network
  }
  // For non-BCH networks, return as-is (don't normalize to BCH)
  return network
}

/**
 * Checks if two network identifiers refer to the same BCH network.
 * @param {string} network1 - First network identifier
 * @param {string} network2 - Second network identifier
 * @returns {boolean} True if both networks are BCH (normalized to same value)
 */
function networksMatch (network1, network2) {
  const normalized1 = normalizeNetwork(network1)
  const normalized2 = normalizeNetwork(network2)
  // Both must normalize to BCH mainnet CAIP-2 to be considered matching
  return normalized1 === BCH_MAINNET_CAIP2 && normalized2 === BCH_MAINNET_CAIP2 && normalized1 === normalized2
}

class FacilitatorUseCase {
  constructor (localConfig = {}) {
    this.adapters = localConfig.adapters
    if (!this.adapters) {
      throw new Error(
        'Instance of adapters must be passed in when instantiating Facilitator Use Case.'
      )
    }

    // Bind 'this' object to all class methods
    this.listSupportedKinds = this.listSupportedKinds.bind(this)
    this.validateUtxo = this.validateUtxo.bind(this)
    this.verifyPayment = this.verifyPayment.bind(this)
    this.settlePayment = this.settlePayment.bind(this)
    this.findUtxoByAddress = this.findUtxoByAddress.bind(this)
  }

  /**
   * Returns the list of payment "kinds" this facilitator supports.
   *
   * @returns Object with array of supported payment kinds, extensions, and signers
   */
  listSupportedKinds () {
    return {
      kinds: [
        {
          x402Version: 2,
          scheme: 'utxo',
          network: BCH_MAINNET_CAIP2
        }
      ],
      extensions: [],
      signers: {
        'bip122:*': []
      }
    }
  }

  /**
   * Finds a UTXO by payer address for "check my tab" mode.
   * Selects the oldest available UTXO (FIFO) with sufficient balance.
   *
   * @param {string} payerAddress - The payer's BCH cash address
   * @param {string} payTo - The server's BCH cash address (receiver)
   * @param {bigint} requiredValue - The minimum satoshis required
   * @returns {Promise<Object|null>} Selected UTXO record or null if none found
   */
  async findUtxoByAddress (payerAddress, payTo, requiredValue) {
    try {
      const addressDb = this.adapters?.levelDB?.addressDb
      if (!addressDb) {
        throw new Error('Address database not initialized')
      }

      // Get UTXOs for this payer address
      let addressUtxos = []
      try {
        addressUtxos = await addressDb.get(payerAddress)
        if (!Array.isArray(addressUtxos)) {
          addressUtxos = []
        }
      } catch (err) {
        // Address not found in database - no UTXOs for this address
        return null
      }

      // Filter UTXOs that pay to the server's address and have sufficient balance
      const validUtxos = addressUtxos
        .filter(utxo => {
          const receiverMatches = utxo.receiverAddress === payTo
          const remainingBalance = BigInt(utxo.remainingBalanceSat ?? '0')
          const hasSufficientBalance = remainingBalance >= requiredValue
          return receiverMatches && hasSufficientBalance
        })
        .sort((a, b) => {
          // Sort by firstSeen timestamp (oldest first, FIFO)
          const timeA = new Date(a.firstSeen || 0).getTime()
          const timeB = new Date(b.firstSeen || 0).getTime()
          return timeA - timeB
        })

      // Return the oldest valid UTXO
      return validUtxos.length > 0 ? validUtxos[0] : null
    } catch (err) {
      console.error('Error in findUtxoByAddress:', err)
      return null
    }
  }

  // Validate a payment UTXO
  async validateUtxo ({ paymentPayload, paymentRequirements, selectedUtxo = null }) {
    try {
      console.log('validateUtxo() paymentPayload:', paymentPayload)
      console.log('validateUtxo() paymentRequirements:', paymentRequirements)

      /*
        Example paymentPayload and paymentRequirements:

        FacilitatorUseCase verifyPayment() paymentPayload: {
          x402Version: 1,
          scheme: 'utxo',
          network: 'bch',
          payload: {
            signature: 'IO7/1zZZV3qhpaaL29Z3ORc6osYKNLJvCvMg53Gf7uyNTtv4kIzBYLXu+Nl0459EzFL2zGHfFHU6AHO6MZ+Za4A=',
            authorization: {
              from: 'bitcoincash:qz9s2mccqamzppfq708cyfde5ejgmsr9hy7r3unmkk',
              to: 'bitcoincash:qqlrzp23w08434twmvr4fxw672whkjy0py26r63g3d',
              value: 1000,
              txid: 'b74dcfc839eb3693be811be64e563171d83e191388fdda900f2d3b952df01ba7',
              vout: 0,
              amount: 2000
            }
          }
        }
        FacilitatorUseCase verifyPayment() paymentRequirements: {
          scheme: 'utxo',
          network: 'bch',
          minAmountRequired: 1000,
          resource: 'http://localhost:4021/weather',
          description: 'Access to weather data',
          mimeType: '',
          payTo: 'bitcoincash:qqlrzp23w08434twmvr4fxw672whkjy0py26r63g3d',
          maxTimeoutSeconds: 60,
          asset: '0x0000000000000000000000000000000000000001',
          outputSchema: { input: { type: 'http', method: 'GET', discoverable: true } },
          extra: {}
        }
      */

      if (!paymentPayload?.payload?.authorization) {
        return {
          isValid: false,
          invalidReason: 'missing_authorization'
        }
      }

      const { authorization } = paymentPayload.payload
      const { txid, vout } = authorization
      const payerAddress = authorization.from

      // Handle "check my tab" mode - use selected UTXO if provided
      let actualTxid = txid
      let actualVout = vout
      let isCheckMyTabMode = false

      if (txid === '*') {
        isCheckMyTabMode = true
        if (!selectedUtxo) {
          return {
            isValid: false,
            invalidReason: 'no_utxo_found_for_address'
          }
        }
        actualTxid = selectedUtxo.txid
        actualVout = selectedUtxo.vout
      }

      // Generate unique identifier for UTXO,
      // UTXOs are uniquely identified by their TXID and the vout number.
      const utxoId = `${actualTxid}:${actualVout}`

      // Ensure the UTXO database is initialized.
      const utxoDb = this.adapters?.levelDB?.utxoDb
      const addressDb = this.adapters?.levelDB?.addressDb
      if (!utxoDb || !addressDb) {
        throw new Error('UTXO or address database not initialized')
      }

      const walletAdapter = this.adapters.bchWallet
      // const logger = this.adapters.logger
      // const bchjs = walletAdapter.bchjs

      // Calculate the cost of the call in satoshis.
      // Support both v2 'amount' field and v1 'minAmountRequired' field
      const amountValue = paymentRequirements?.amount ?? paymentRequirements?.minAmountRequired ?? paymentRequirements?.maxAmountRequired ?? 0
      const callCostSat = BigInt(amountValue)
      // const revalidateThresholdMs = 5 * 60 * 1000 // 5 minutes

      // Try to get the UTXO information from the Level DB
      let utxoInfo = null
      try {
        utxoInfo = await utxoDb.get(utxoId)
      } catch (err) {
        /* exit quietly */
      }

      if (!utxoInfo) {
        console.log('UTXO not found in Level DB')

        // If check my tab mode and we have selectedUtxo, use it (it should already be validated)
        // Otherwise, validate the UTXO on-chain
        if (isCheckMyTabMode && selectedUtxo) {
          // Use the selected UTXO from addressDb
          utxoInfo = selectedUtxo
          // Ensure it's also in utxoDb (in case of data inconsistency)
          await utxoDb.put(utxoId, utxoInfo)
        } else {
          // Validate the UTXO on-chain
          const utxoValidation = await walletAdapter.validateUtxo({ txid: actualTxid, vout: actualVout })
          console.log('utxoValidation:', utxoValidation)

          if (!utxoValidation.isValid) {
            return {
              isValid: false,
              invalidReason: utxoValidation.invalidReason || 'utxo_not_found',
              utxoAmountSat: null
            }
          }

          const remainingBalanceSat = BigInt(utxoValidation.utxoAmountSat) - callCostSat
          if (remainingBalanceSat < 0n) {
            return {
              isValid: false,
              invalidReason: 'insufficient_utxo_balance',
              utxoAmountSat: utxoValidation.utxoAmountSat.toString()
            }
          }

          const timestamp = new Date().toISOString()
          const record = {
            utxoId,
            txid: actualTxid,
            vout: actualVout,
            payerAddress,
            receiverAddress: utxoValidation.receiverAddress,
            transactionValueSat: utxoValidation.utxoAmountSat.toString(),
            remainingBalanceSat: remainingBalanceSat.toString(),
            totalDebitedSat: callCostSat.toString(),
            lastUpdated: timestamp,
            firstSeen: timestamp,
            lastChecked: timestamp
          }

          await utxoDb.put(utxoId, record)

          // Add to addressDb
          await this.addUtxoToAddressDb(addressDb, payerAddress, record)

          console.log('UTXO added to Level DB')

          return {
            isValid: true,
            remainingBalanceSat: remainingBalanceSat.toString(),
            utxoInfo: record
          }
        }
      }

      // Update existing UTXO
      const currentRemainingSat = BigInt(
        utxoInfo.remainingBalanceSat ?? utxoInfo.remainingBalance ?? '0'
      )
      const totalDebitedSat = BigInt(
        utxoInfo.totalDebitedSat ?? utxoInfo.totalDebited ?? '0'
      )

      const updatedRemainingSat = currentRemainingSat - callCostSat

      if (updatedRemainingSat < 0n) {
        return {
          isValid: false,
          invalidReason: 'insufficient_utxo_balance',
          remainingBalanceSat: currentRemainingSat.toString()
        }
      }

      const updatedTotalDebitedSat = totalDebitedSat + callCostSat
      const timestamp = new Date().toISOString()
      const updatedRecord = {
        ...utxoInfo,
        remainingBalanceSat: updatedRemainingSat.toString(),
        totalDebitedSat: updatedTotalDebitedSat.toString(),
        lastUpdated: timestamp,
        lastChecked: timestamp
      }

      await utxoDb.put(utxoId, updatedRecord)

      // Update addressDb entry
      await this.updateUtxoInAddressDb(addressDb, payerAddress, updatedRecord)

      // If UTXO is consumed (remainingBalanceSat reaches 0), delete from both databases
      if (updatedRemainingSat === 0n) {
        await utxoDb.del(utxoId)
        await this.removeUtxoFromAddressDb(addressDb, payerAddress, utxoId)
        console.log('UTXO consumed and removed from databases')
      }

      return {
        isValid: true,
        remainingBalanceSat: updatedRemainingSat.toString(),
        utxoInfo: updatedRecord
      }
    } catch (err) {
      console.error('Error in validateUtxo:', err)
      return {
        isValid: false,
        invalidReason: 'unexpected_utxo_validation_error',
        errorMessage: err.message
      }
    }
  }

  /**
   * Helper method to add a UTXO to the address-based database
   * @private
   */
  async addUtxoToAddressDb (addressDb, payerAddress, utxoRecord) {
    try {
      let addressUtxos = []
      try {
        addressUtxos = await addressDb.get(payerAddress)
        if (!Array.isArray(addressUtxos)) {
          addressUtxos = []
        }
      } catch (err) {
        // Address not found, start with empty array
        addressUtxos = []
      }

      // Check if UTXO already exists in the array
      const existingIndex = addressUtxos.findIndex(utxo => utxo.utxoId === utxoRecord.utxoId)
      if (existingIndex >= 0) {
        // Update existing entry
        addressUtxos[existingIndex] = utxoRecord
      } else {
        // Add new entry
        addressUtxos.push(utxoRecord)
      }

      await addressDb.put(payerAddress, addressUtxos)
    } catch (err) {
      console.error('Error adding UTXO to addressDb:', err)
      // Don't throw - this is a secondary index
    }
  }

  /**
   * Helper method to update a UTXO in the address-based database
   * @private
   */
  async updateUtxoInAddressDb (addressDb, payerAddress, utxoRecord) {
    try {
      let addressUtxos = []
      try {
        addressUtxos = await addressDb.get(payerAddress)
        if (!Array.isArray(addressUtxos)) {
          return // No UTXOs for this address
        }
      } catch (err) {
        return // Address not found
      }

      // Find and update the UTXO
      const index = addressUtxos.findIndex(utxo => utxo.utxoId === utxoRecord.utxoId)
      if (index >= 0) {
        addressUtxos[index] = utxoRecord
        await addressDb.put(payerAddress, addressUtxos)
      }
    } catch (err) {
      console.error('Error updating UTXO in addressDb:', err)
      // Don't throw - this is a secondary index
    }
  }

  /**
   * Helper method to remove a UTXO from the address-based database
   * @private
   */
  async removeUtxoFromAddressDb (addressDb, payerAddress, utxoId) {
    try {
      let addressUtxos = []
      try {
        addressUtxos = await addressDb.get(payerAddress)
        if (!Array.isArray(addressUtxos)) {
          return // No UTXOs for this address
        }
      } catch (err) {
        return // Address not found
      }

      // Filter out the UTXO
      const filteredUtxos = addressUtxos.filter(utxo => utxo.utxoId !== utxoId)

      if (filteredUtxos.length === 0) {
        // Remove the address key if no UTXOs remain
        await addressDb.del(payerAddress)
      } else {
        // Update with filtered array
        await addressDb.put(payerAddress, filteredUtxos)
      }
    } catch (err) {
      console.error('Error removing UTXO from addressDb:', err)
      // Don't throw - this is a secondary index
    }
  }

  /**
   * Verifies a payment authorization without settling it on-chain.
   *
   * Checks the signature and payment details are valid according to the
   * payment requirements.
   *
   * @param paymentPayload The signed payment authorization
   * @param paymentRequirements The expected payment details
   * @returns Verification result with validity and payer address
   */
  async verifyPayment (paymentPayload, paymentRequirements) {
    console.log('FacilitatorUseCase verifyPayment() paymentPayload:', paymentPayload)
    console.log('FacilitatorUseCase verifyPayment() paymentRequirements:', paymentRequirements)

    try {
      const bchjs = this.adapters.bchWallet.bchjs

      // Extract scheme and network from v2 structure (accepted field) or v1 structure (top-level)
      const payloadScheme = paymentPayload.accepted?.scheme ?? paymentPayload.scheme
      const payloadNetwork = paymentPayload.accepted?.network ?? paymentPayload.network

      // Verify network matches (support both v1 'bch' and v2 CAIP-2 formats)
      if (!networksMatch(paymentRequirements.network, payloadNetwork)) {
        return {
          isValid: false,
          invalidReason: 'invalid_network',
          payer: ''
        }
      }

      // Verify scheme matches
      const requirementsScheme = paymentRequirements.scheme
      if (requirementsScheme !== 'utxo' || payloadScheme !== 'utxo') {
        return {
          isValid: false,
          invalidReason: 'invalid_scheme',
          payer: ''
        }
      }

      // Extract authorization and signature
      const payload = paymentPayload.payload
      if (!payload || !payload.authorization || !payload.signature) {
        return {
          isValid: false,
          invalidReason: 'invalid_payload',
          payer: ''
        }
      }

      const { authorization, signature } = payload
      const payerAddress = authorization.from
      const payTo = paymentRequirements.payTo

      // Check if this is "check my tab" mode
      const isCheckMyTabMode = authorization.txid === '*'

      // For check my tab mode, verify signature with the original authorization object
      // (including txid: "*", vout: null, amount: null)
      // For standard mode, use the authorization as-is
      const messageToVerify = JSON.stringify(authorization)
      let isValidSignature = false

      try {
        isValidSignature = bchjs.BitcoinCash.verifyMessage(
          payerAddress,
          signature,
          messageToVerify
        )
      } catch (error) {
        this.adapters.logger.error('Error verifying signature:', error)
        return {
          isValid: false,
          invalidReason: 'invalid_exact_bch_payload_signature',
          payer: payerAddress
        }
      }

      if (!isValidSignature) {
        return {
          isValid: false,
          invalidReason: 'invalid_exact_bch_payload_signature',
          payer: payerAddress
        }
      }

      // Handle "check my tab" mode - select UTXO by address
      let selectedUtxo = null
      if (isCheckMyTabMode) {
        // Calculate required value
        const amountValue = paymentRequirements?.amount ?? paymentRequirements?.minAmountRequired ?? paymentRequirements?.maxAmountRequired ?? 0
        const requiredValue = BigInt(amountValue)

        // Find UTXO by address
        selectedUtxo = await this.findUtxoByAddress(payerAddress, payTo, requiredValue)

        if (!selectedUtxo) {
          return {
            isValid: false,
            invalidReason: 'no_utxo_found_for_address',
            payer: payerAddress
          }
        }

        console.log('Check my tab mode: Selected UTXO:', selectedUtxo)
      }

      // Validate the UTXO is still valid for paying for this call.
      const utxoValidation = await this.validateUtxo({ paymentPayload, paymentRequirements, selectedUtxo })
      console.log('utxoValidation:', utxoValidation)

      if (!utxoValidation.isValid) {
        return {
          isValid: false,
          invalidReason: utxoValidation.invalidReason || 'invalid_utxo',
          payer: payerAddress
        }
      }

      // Build response with optional fields
      const response = {
        isValid: true,
        payer: payerAddress
      }

      // Include optional fields if available
      if (utxoValidation.remainingBalanceSat !== undefined) {
        response.remainingBalanceSat = utxoValidation.remainingBalanceSat
      }
      if (utxoValidation.utxoInfo) {
        response.ledgerEntry = {
          utxoId: utxoValidation.utxoInfo.utxoId,
          transactionValueSat: utxoValidation.utxoInfo.transactionValueSat,
          totalDebitedSat: utxoValidation.utxoInfo.totalDebitedSat,
          lastUpdated: utxoValidation.utxoInfo.lastUpdated
        }
      }

      return response
    } catch (error) {
      this.adapters.logger.error('Error in verifyPayment:', error)
      return {
        isValid: false,
        invalidReason: 'unexpected_verify_error',
        payer: paymentPayload?.payload?.authorization?.from || ''
      }
    }
  }

  /**
   * Settles a payment by broadcasting the transaction to the blockchain.
   *
   * Creates a transaction from the payment authorization and broadcasts it
   * to the Bitcoin Cash network.
   *
   * @param paymentPayload The signed payment authorization
   * @param paymentRequirements The expected payment details
   * @returns Settlement result with transaction hash and status
   */
  async settlePayment (paymentPayload, paymentRequirements) {
    this.adapters.logger.info('FacilitatorUseCase settlePayment() paymentPayload:', paymentPayload)
    this.adapters.logger.info('FacilitatorUseCase settlePayment() paymentRequirements:', paymentRequirements)

    try {
      // Re-verify payment
      const verification = await this.verifyPayment(paymentPayload, paymentRequirements)

      if (!verification.isValid) {
        // Always return BCH mainnet CAIP-2 format in response (this is a BCH facilitator)
        return {
          success: false,
          errorReason: verification.invalidReason || 'invalid_payment',
          transaction: '',
          network: BCH_MAINNET_CAIP2,
          payer: verification.payer || ''
        }
      }

      const payerAddress = verification.payer
      const authorization = paymentPayload.payload.authorization
      const amount = parseInt(authorization.value, 10) // Amount in satoshis
      const payTo = paymentRequirements.payTo

      // Initialize wallet if not already initialized
      if (!this.adapters.bchWallet.isWalletInitialized()) {
        await this.adapters.bchWallet.initializeWallet()
      }

      const wallet = this.adapters.bchWallet.getWallet()
      const facilitatorAddress = this.adapters.bchWallet.getFacilitatorAddress()

      // Create and broadcast transaction
      // Note: The facilitator creates the transaction, not the payer
      // This is different from EVM where we use the signed authorization
      // For BCH, we need to create a new transaction from the facilitator's wallet
      // However, the payment authorization proves the payer's intent
      // In a real implementation, you might want to use a different approach
      // For now, we'll create a transaction from facilitator to payTo with the authorized amount

      // Check facilitator balance first
      const facilitatorBalance = await wallet.getBalance({ bchAddress: facilitatorAddress })
      // Always return BCH mainnet CAIP-2 format in response (this is a BCH facilitator)
      if (facilitatorBalance < amount) {
        return {
          success: false,
          errorReason: 'insufficient_funds',
          transaction: '',
          network: BCH_MAINNET_CAIP2,
          payer: payerAddress
        }
      }

      // Create transaction
      const outputs = [
        {
          address: payTo,
          amount
        }
      ]

      const txid = await wallet.send(outputs)

      if (!txid) {
        return {
          success: false,
          errorReason: 'invalid_transaction_state',
          transaction: '',
          network: BCH_MAINNET_CAIP2,
          payer: payerAddress
        }
      }

      // Wait for confirmations if required
      const minConfirmations = this.adapters.bchWallet.getMinConfirmations()
      if (minConfirmations > 0) {
        // In a production system, you would wait for confirmations here
        // For now, we'll just return the txid
        // You could use bchjs.Blockchain.getTransaction(txid) to check confirmations
      }

      // Get remaining balance from verification if available
      const remainingBalanceSat = verification.remainingBalanceSat

      const response = {
        success: true,
        transaction: txid,
        network: BCH_MAINNET_CAIP2,
        payer: payerAddress
      }

      if (remainingBalanceSat !== undefined) {
        response.remainingBalanceSat = remainingBalanceSat
      }

      return response
    } catch (error) {
      this.adapters.logger.error('Error in settlePayment:', error)
      // Always return BCH mainnet CAIP-2 format in response (this is a BCH facilitator)
      return {
        success: false,
        errorReason: 'unexpected_settle_error',
        transaction: '',
        network: BCH_MAINNET_CAIP2,
        payer: paymentPayload?.payload?.authorization?.from || ''
      }
    }
  }
}

export { normalizeNetwork, networksMatch }
export default FacilitatorUseCase
