/*
  Unit tests for the leveldb adapter.
*/

// npm libraries
import { assert } from 'chai'
import sinon from 'sinon'

// Unit under test
import LevelDBAdapter from '../../../src/adapters/leveldb.js'

describe('#adapters/leveldb.js', () => {
  let sandbox
  let mockLevelDb
  let levelStub

  beforeEach(() => {
    sandbox = sinon.createSandbox()
    mockLevelDb = {
      close: sandbox.stub().resolves()
    }
    levelStub = sandbox.stub().returns(mockLevelDb)
  })

  afterEach(() => {
    sandbox.restore()
  })

  describe('#constructor', () => {
    it('should create LevelDBAdapter instance', () => {
      const adapter = new LevelDBAdapter()
      assert.isNotNull(adapter)
      assert.isNull(adapter.utxoDb)
      assert.isNull(adapter.addressDb)
      assert.isFunction(adapter.openDb)
    })
  })

  describe('#openDb', () => {
    it('should open database and return utxoDb and addressDb', () => {
      const adapter = new LevelDBAdapter()
      adapter.level = levelStub

      const result = adapter.openDb()

      assert.isTrue(levelStub.calledTwice) // Called once for utxoDb, once for addressDb
      assert.equal(adapter.utxoDb, mockLevelDb)
      assert.equal(adapter.addressDb, mockLevelDb)
      assert.property(result, 'utxoDb')
      assert.property(result, 'addressDb')
      assert.equal(result.utxoDb, mockLevelDb)
      assert.equal(result.addressDb, mockLevelDb)
    })
  })

  describe('#closeDb', () => {
    it('should close database if it exists', async () => {
      const adapter = new LevelDBAdapter()
      adapter.utxoDb = mockLevelDb
      adapter.addressDb = mockLevelDb

      const result = await adapter.closeDb()

      assert.isTrue(mockLevelDb.close.calledTwice) // Called once for utxoDb, once for addressDb
      assert.isNull(adapter.utxoDb)
      assert.isNull(adapter.addressDb)
      assert.isTrue(result)
    })

    it('should return true if database does not exist', async () => {
      const adapter = new LevelDBAdapter()
      adapter.utxoDb = null
      adapter.addressDb = null

      const result = await adapter.closeDb()

      assert.isTrue(mockLevelDb.close.notCalled)
      assert.isTrue(result)
    })
  })
})
