/*
  Unit tests for the facilitator use case.
*/

// npm libraries
import { assert } from 'chai'
import sinon from 'sinon'

// Unit under test
import FacilitatorUseCase from '../../../src/use-cases/facilitator.js'

describe('#use-cases/facilitator.js', () => {
  let sandbox
  let mockAdapters
  let mockLogger
  let mockBchWallet
  let mockBchjs
  let mockLevelDB
  let mockUtxoDb
  let mockAddressDb

  beforeEach(() => {
    sandbox = sinon.createSandbox()
    mockUtxoDb = {
      get: sandbox.stub(),
      put: sandbox.stub().resolves(),
      del: sandbox.stub().resolves()
    }
    mockAddressDb = {
      get: sandbox.stub(),
      put: sandbox.stub().resolves(),
      del: sandbox.stub().resolves()
    }
    mockLevelDB = {
      utxoDb: mockUtxoDb,
      addressDb: mockAddressDb
    }
    mockBchjs = {
      BitcoinCash: {
        verifyMessage: sandbox.stub().returns(true)
      }
    }
    mockBchWallet = {
      bchjs: mockBchjs,
      validateUtxo: sandbox.stub().resolves({
        isValid: true,
        utxoAmountSat: 2000,
        receiverAddress: 'bitcoincash:qptest'
      }),
      isWalletInitialized: sandbox.stub().returns(true),
      initializeWallet: sandbox.stub().resolves(),
      getWallet: sandbox.stub().returns({
        getBalance: sandbox.stub().resolves(10000),
        send: sandbox.stub().resolves('txid123')
      }),
      getFacilitatorAddress: sandbox.stub().returns('bitcoincash:facilitator'),
      getMinConfirmations: sandbox.stub().returns(0)
    }
    mockLogger = {
      info: sandbox.stub(),
      error: sandbox.stub()
    }
    mockAdapters = {
      logger: mockLogger,
      bchWallet: mockBchWallet,
      levelDB: mockLevelDB
    }
  })

  afterEach(() => {
    sandbox.restore()
  })

  describe('#constructor', () => {
    it('should create FacilitatorUseCase instance', () => {
      const useCase = new FacilitatorUseCase({ adapters: mockAdapters })
      assert.isNotNull(useCase)
      assert.property(useCase, 'adapters')
    })

    it('should throw error when adapters are not provided', () => {
      assert.throws(
        () => new FacilitatorUseCase(),
        /Instance of adapters must be passed in/
      )
    })
  })

  describe('#listSupportedKinds', () => {
    it('should return supported payment kinds in v2 format', () => {
      const useCase = new FacilitatorUseCase({ adapters: mockAdapters })
      const result = useCase.listSupportedKinds()

      assert.property(result, 'kinds')
      assert.isArray(result.kinds)
      assert.lengthOf(result.kinds, 1)
      assert.deepEqual(result.kinds[0], {
        x402Version: 2,
        scheme: 'utxo',
        network: 'bip122:000000000000000000651ef99cb9fcbe'
      })
      assert.property(result, 'extensions')
      assert.isArray(result.extensions)
      assert.property(result, 'signers')
      assert.property(result.signers, 'bip122:*')
      assert.isArray(result.signers['bip122:*'])
    })
  })

  describe('#validateUtxo', () => {
    it('should return invalid when authorization is missing', async () => {
      const useCase = new FacilitatorUseCase({ adapters: mockAdapters })
      const paymentPayload = {}
      const paymentRequirements = { minAmountRequired: 1000 }

      const result = await useCase.validateUtxo({ paymentPayload, paymentRequirements })

      assert.isFalse(result.isValid)
      assert.equal(result.invalidReason, 'missing_authorization')
    })

    it('should return error when UTXO database is not initialized', async () => {
      const useCase = new FacilitatorUseCase({ adapters: { ...mockAdapters, levelDB: {} } })
      const paymentPayload = {
        payload: {
          authorization: {
            txid: 'tx123',
            vout: 0,
            from: 'bitcoincash:qptest'
          }
        }
      }
      const paymentRequirements = { minAmountRequired: 1000 }

      const result = await useCase.validateUtxo({ paymentPayload, paymentRequirements })

      assert.isFalse(result.isValid)
      assert.equal(result.invalidReason, 'unexpected_utxo_validation_error')
      assert.include(result.errorMessage, 'UTXO or address database not initialized')
    })

    it('should validate new UTXO and add to database with v1 minAmountRequired', async () => {
      const useCase = new FacilitatorUseCase({ adapters: mockAdapters })
      const paymentPayload = {
        payload: {
          authorization: {
            txid: 'tx123',
            vout: 0,
            from: 'bitcoincash:qptest'
          }
        }
      }
      const paymentRequirements = { minAmountRequired: 1000, payTo: 'bitcoincash:qptest' }

      mockUtxoDb.get.rejects(new Error('NotFound'))
      mockAddressDb.get.rejects(new Error('NotFound')) // Address not in addressDb yet
      mockBchWallet.validateUtxo.resolves({
        isValid: true,
        utxoAmountSat: 2000,
        receiverAddress: 'bitcoincash:qptest'
      })

      const result = await useCase.validateUtxo({ paymentPayload, paymentRequirements })

      assert.isTrue(result.isValid)
      assert.property(result, 'remainingBalanceSat')
      assert.property(result, 'utxoInfo')
      assert.isTrue(mockUtxoDb.put.calledOnce)
      assert.isTrue(mockAddressDb.put.calledOnce) // Should also add to addressDb
    })

    it('should validate new UTXO and add to database with v2 amount field', async () => {
      const useCase = new FacilitatorUseCase({ adapters: mockAdapters })
      const paymentPayload = {
        payload: {
          authorization: {
            txid: 'tx123',
            vout: 0,
            from: 'bitcoincash:qptest'
          }
        }
      }
      const paymentRequirements = { amount: '1000', payTo: 'bitcoincash:qptest' }

      mockUtxoDb.get.rejects(new Error('NotFound'))
      mockAddressDb.get.rejects(new Error('NotFound')) // Address not in addressDb yet
      mockBchWallet.validateUtxo.resolves({
        isValid: true,
        utxoAmountSat: 2000,
        receiverAddress: 'bitcoincash:qptest'
      })

      const result = await useCase.validateUtxo({ paymentPayload, paymentRequirements })

      assert.isTrue(result.isValid)
      assert.property(result, 'remainingBalanceSat')
      assert.property(result, 'utxoInfo')
      assert.isTrue(mockUtxoDb.put.calledOnce)
      assert.isTrue(mockAddressDb.put.calledOnce) // Should also add to addressDb
    })

    it('should return invalid when UTXO balance is insufficient', async () => {
      const useCase = new FacilitatorUseCase({ adapters: mockAdapters })
      const paymentPayload = {
        payload: {
          authorization: {
            txid: 'tx123',
            vout: 0,
            from: 'bitcoincash:qptest'
          }
        }
      }
      const paymentRequirements = { minAmountRequired: 3000, payTo: 'bitcoincash:qptest' }

      mockUtxoDb.get.rejects(new Error('NotFound'))
      mockBchWallet.validateUtxo.resolves({
        isValid: true,
        utxoAmountSat: 2000,
        receiverAddress: 'bitcoincash:qptest'
      })

      const result = await useCase.validateUtxo({ paymentPayload, paymentRequirements })

      assert.isFalse(result.isValid)
      assert.equal(result.invalidReason, 'insufficient_utxo_balance')
    })

    it('should update existing UTXO in database', async () => {
      const useCase = new FacilitatorUseCase({ adapters: mockAdapters })
      const paymentPayload = {
        payload: {
          authorization: {
            txid: 'tx123',
            vout: 0,
            from: 'bitcoincash:qptest'
          }
        }
      }
      const paymentRequirements = { minAmountRequired: 500, payTo: 'bitcoincash:qptest' }

      const existingUtxo = {
        utxoId: 'tx123:0',
        txid: 'tx123',
        vout: 0,
        payerAddress: 'bitcoincash:qptest',
        receiverAddress: 'bitcoincash:qptest',
        remainingBalanceSat: '1500',
        totalDebitedSat: '500'
      }

      mockUtxoDb.get.resolves(existingUtxo)
      mockAddressDb.get.resolves([existingUtxo]) // AddressDb has the UTXO

      const result = await useCase.validateUtxo({ paymentPayload, paymentRequirements })

      assert.isTrue(result.isValid)
      assert.equal(result.remainingBalanceSat, '1000')
      assert.isTrue(mockUtxoDb.put.calledOnce)
      assert.isTrue(mockAddressDb.put.calledOnce) // Should also update addressDb
    })

    it('should return invalid when existing UTXO has insufficient balance', async () => {
      const useCase = new FacilitatorUseCase({ adapters: mockAdapters })
      const paymentPayload = {
        payload: {
          authorization: {
            txid: 'tx123',
            vout: 0,
            from: 'bitcoincash:qptest'
          }
        }
      }
      const paymentRequirements = { minAmountRequired: 2000, payTo: 'bitcoincash:qptest' }

      const existingUtxo = {
        utxoId: 'tx123:0',
        txid: 'tx123',
        vout: 0,
        payerAddress: 'bitcoincash:qptest',
        receiverAddress: 'bitcoincash:qptest',
        remainingBalanceSat: '1000',
        totalDebitedSat: '1000'
      }

      mockUtxoDb.get.resolves(existingUtxo)
      mockAddressDb.get.resolves([existingUtxo]) // AddressDb has the UTXO

      const result = await useCase.validateUtxo({ paymentPayload, paymentRequirements })

      assert.isFalse(result.isValid)
      assert.equal(result.invalidReason, 'insufficient_utxo_balance')
    })
  })

  describe('#verifyPayment', () => {
    const createValidPaymentPayloadV1 = () => ({
      x402Version: 1,
      scheme: 'utxo',
      network: 'bch',
      payload: {
        signature: 'test-signature',
        authorization: {
          from: 'bitcoincash:qptest',
          to: 'bitcoincash:qprecv',
          value: 1000,
          txid: 'tx123',
          vout: 0,
          amount: 2000
        }
      }
    })

    const createValidPaymentPayloadV2 = () => ({
      x402Version: 2,
      accepted: {
        scheme: 'utxo',
        network: 'bip122:000000000000000000651ef99cb9fcbe',
        amount: '1000',
        payTo: 'bitcoincash:qprecv'
      },
      payload: {
        signature: 'test-signature',
        authorization: {
          from: 'bitcoincash:qptest',
          to: 'bitcoincash:qprecv',
          value: '1000',
          txid: 'tx123',
          vout: 0,
          amount: '2000'
        }
      }
    })

    const createValidPaymentRequirementsV1 = () => ({
      scheme: 'utxo',
      network: 'bch',
      minAmountRequired: 1000,
      payTo: 'bitcoincash:qprecv'
    })

    const createValidPaymentRequirementsV2 = () => ({
      scheme: 'utxo',
      network: 'bip122:000000000000000000651ef99cb9fcbe',
      amount: '1000',
      payTo: 'bitcoincash:qprecv'
    })

    it('should return invalid when network does not match', async () => {
      const useCase = new FacilitatorUseCase({ adapters: mockAdapters })
      const paymentPayload = createValidPaymentPayloadV1()
      const paymentRequirements = { ...createValidPaymentRequirementsV1(), network: 'btc' }

      const result = await useCase.verifyPayment(paymentPayload, paymentRequirements)

      assert.isFalse(result.isValid)
      assert.equal(result.invalidReason, 'invalid_network')
    })

    it('should return invalid when scheme does not match', async () => {
      const useCase = new FacilitatorUseCase({ adapters: mockAdapters })
      const paymentPayload = { ...createValidPaymentPayloadV1(), scheme: 'account' }
      const paymentRequirements = createValidPaymentRequirementsV1()

      const result = await useCase.verifyPayment(paymentPayload, paymentRequirements)

      assert.isFalse(result.isValid)
      assert.equal(result.invalidReason, 'invalid_scheme')
    })

    it('should return invalid when payload is missing', async () => {
      const useCase = new FacilitatorUseCase({ adapters: mockAdapters })
      const paymentPayload = { scheme: 'utxo', network: 'bch' }
      const paymentRequirements = createValidPaymentRequirementsV1()

      const result = await useCase.verifyPayment(paymentPayload, paymentRequirements)

      assert.isFalse(result.isValid)
      assert.equal(result.invalidReason, 'invalid_payload')
    })

    it('should return invalid when signature verification fails', async () => {
      const useCase = new FacilitatorUseCase({ adapters: mockAdapters })
      const paymentPayload = createValidPaymentPayloadV1()
      const paymentRequirements = createValidPaymentRequirementsV1()

      mockBchjs.BitcoinCash.verifyMessage.returns(false)
      mockUtxoDb.get.rejects(new Error('NotFound'))
      mockBchWallet.validateUtxo.resolves({
        isValid: true,
        utxoAmountSat: 2000,
        receiverAddress: 'bitcoincash:qptest'
      })

      const result = await useCase.verifyPayment(paymentPayload, paymentRequirements)

      assert.isFalse(result.isValid)
      assert.equal(result.invalidReason, 'invalid_exact_bch_payload_signature')
    })

    it('should verify valid payment with v1 format', async () => {
      const useCase = new FacilitatorUseCase({ adapters: mockAdapters })
      const paymentPayload = createValidPaymentPayloadV1()
      const paymentRequirements = createValidPaymentRequirementsV1()

      mockBchjs.BitcoinCash.verifyMessage.returns(true)
      mockUtxoDb.get.rejects(new Error('NotFound'))
      mockAddressDb.get.rejects(new Error('NotFound')) // Address not in addressDb yet
      mockBchWallet.validateUtxo.resolves({
        isValid: true,
        utxoAmountSat: 2000,
        receiverAddress: 'bitcoincash:qprecv'
      })

      const result = await useCase.verifyPayment(paymentPayload, paymentRequirements)

      assert.isTrue(result.isValid)
      assert.equal(result.payer, 'bitcoincash:qptest')
      assert.property(result, 'remainingBalanceSat')
      assert.property(result, 'ledgerEntry')
    })

    it('should verify valid payment with v2 format', async () => {
      const useCase = new FacilitatorUseCase({ adapters: mockAdapters })
      const paymentPayload = createValidPaymentPayloadV2()
      const paymentRequirements = createValidPaymentRequirementsV2()

      mockBchjs.BitcoinCash.verifyMessage.returns(true)
      mockUtxoDb.get.rejects(new Error('NotFound'))
      mockAddressDb.get.rejects(new Error('NotFound')) // Address not in addressDb yet
      mockBchWallet.validateUtxo.resolves({
        isValid: true,
        utxoAmountSat: 2000,
        receiverAddress: 'bitcoincash:qprecv'
      })

      const result = await useCase.verifyPayment(paymentPayload, paymentRequirements)

      assert.isTrue(result.isValid)
      assert.equal(result.payer, 'bitcoincash:qptest')
      assert.property(result, 'remainingBalanceSat')
      assert.property(result, 'ledgerEntry')
    })

    it('should handle CAIP-2 network format', async () => {
      const useCase = new FacilitatorUseCase({ adapters: mockAdapters })
      const paymentPayload = createValidPaymentPayloadV2()
      const paymentRequirements = createValidPaymentRequirementsV2()

      mockBchjs.BitcoinCash.verifyMessage.returns(true)
      mockUtxoDb.get.rejects(new Error('NotFound'))
      mockAddressDb.get.rejects(new Error('NotFound')) // Address not in addressDb yet
      mockBchWallet.validateUtxo.resolves({
        isValid: true,
        utxoAmountSat: 2000,
        receiverAddress: 'bitcoincash:qprecv'
      })

      const result = await useCase.verifyPayment(paymentPayload, paymentRequirements)

      assert.isTrue(result.isValid)
    })

    it('should handle signature verification errors', async () => {
      const useCase = new FacilitatorUseCase({ adapters: mockAdapters })
      const paymentPayload = createValidPaymentPayloadV1()
      const paymentRequirements = createValidPaymentRequirementsV1()

      const sigError = new Error('Signature error')
      mockBchjs.BitcoinCash.verifyMessage.throws(sigError)

      const result = await useCase.verifyPayment(paymentPayload, paymentRequirements)

      assert.isFalse(result.isValid)
      assert.equal(result.invalidReason, 'invalid_exact_bch_payload_signature')
      assert.isTrue(mockLogger.error.calledOnce)
    })
  })

  describe('#settlePayment', () => {
    const createValidPaymentPayloadV1 = () => ({
      x402Version: 1,
      scheme: 'utxo',
      network: 'bch',
      payload: {
        signature: 'test-signature',
        authorization: {
          from: 'bitcoincash:qptest',
          to: 'bitcoincash:qprecv',
          value: 1000,
          txid: 'tx123',
          vout: 0,
          amount: 2000
        }
      }
    })

    const createValidPaymentPayloadV2 = () => ({
      x402Version: 2,
      accepted: {
        scheme: 'utxo',
        network: 'bip122:000000000000000000651ef99cb9fcbe',
        amount: '1000',
        payTo: 'bitcoincash:qprecv'
      },
      payload: {
        signature: 'test-signature',
        authorization: {
          from: 'bitcoincash:qptest',
          to: 'bitcoincash:qprecv',
          value: '1000',
          txid: 'tx123',
          vout: 0,
          amount: '2000'
        }
      }
    })

    const createValidPaymentRequirementsV1 = () => ({
      scheme: 'utxo',
      network: 'bch',
      minAmountRequired: 1000,
      payTo: 'bitcoincash:qprecv'
    })

    const createValidPaymentRequirementsV2 = () => ({
      scheme: 'utxo',
      network: 'bip122:000000000000000000651ef99cb9fcbe',
      amount: '1000',
      payTo: 'bitcoincash:qprecv'
    })

    it('should return error when verification fails', async () => {
      const useCase = new FacilitatorUseCase({ adapters: mockAdapters })
      const paymentPayload = createValidPaymentPayloadV1()
      const paymentRequirements = { ...createValidPaymentRequirementsV1(), network: 'btc' }

      const result = await useCase.settlePayment(paymentPayload, paymentRequirements)

      assert.isFalse(result.success)
      assert.property(result, 'errorReason')
      assert.equal(result.transaction, '')
      assert.equal(result.network, 'bip122:000000000000000000651ef99cb9fcbe')
    })

    it('should settle valid payment with v1 format', async () => {
      const useCase = new FacilitatorUseCase({ adapters: mockAdapters })
      const paymentPayload = createValidPaymentPayloadV1()
      const paymentRequirements = createValidPaymentRequirementsV1()

      mockBchjs.BitcoinCash.verifyMessage.returns(true)
      mockUtxoDb.get.rejects(new Error('NotFound'))
      mockAddressDb.get.rejects(new Error('NotFound')) // Address not in addressDb yet
      mockBchWallet.validateUtxo.resolves({
        isValid: true,
        utxoAmountSat: 2000,
        receiverAddress: 'bitcoincash:qprecv'
      })

      const result = await useCase.settlePayment(paymentPayload, paymentRequirements)

      assert.isTrue(result.success)
      assert.equal(result.transaction, 'txid123')
      assert.equal(result.network, 'bip122:000000000000000000651ef99cb9fcbe')
      assert.equal(result.payer, 'bitcoincash:qptest')
    })

    it('should settle valid payment with v2 format', async () => {
      const useCase = new FacilitatorUseCase({ adapters: mockAdapters })
      const paymentPayload = createValidPaymentPayloadV2()
      const paymentRequirements = createValidPaymentRequirementsV2()

      mockBchjs.BitcoinCash.verifyMessage.returns(true)
      mockUtxoDb.get.rejects(new Error('NotFound'))
      mockAddressDb.get.rejects(new Error('NotFound')) // Address not in addressDb yet
      mockBchWallet.validateUtxo.resolves({
        isValid: true,
        utxoAmountSat: 2000,
        receiverAddress: 'bitcoincash:qprecv'
      })

      const result = await useCase.settlePayment(paymentPayload, paymentRequirements)

      assert.isTrue(result.success)
      assert.equal(result.transaction, 'txid123')
      assert.equal(result.network, 'bip122:000000000000000000651ef99cb9fcbe')
      assert.equal(result.payer, 'bitcoincash:qptest')
    })

    it('should handle errors during settlement', async () => {
      const useCase = new FacilitatorUseCase({ adapters: mockAdapters })
      const paymentPayload = createValidPaymentPayloadV1()
      const paymentRequirements = createValidPaymentRequirementsV1()

      mockBchjs.BitcoinCash.verifyMessage.returns(true)
      mockUtxoDb.get.rejects(new Error('NotFound'))
      mockAddressDb.get.rejects(new Error('NotFound')) // Address not in addressDb yet
      mockBchWallet.validateUtxo.resolves({
        isValid: true,
        utxoAmountSat: 2000,
        receiverAddress: 'bitcoincash:qprecv'
      })
      mockBchWallet.getWallet().send.rejects(new Error('Send failed'))

      const result = await useCase.settlePayment(paymentPayload, paymentRequirements)

      assert.isFalse(result.success)
      assert.equal(result.errorReason, 'unexpected_settle_error')
      assert.equal(result.network, 'bip122:000000000000000000651ef99cb9fcbe')
      assert.isTrue(mockLogger.error.calledOnce)
    })
  })
})
