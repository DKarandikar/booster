/* eslint-disable @typescript-eslint/no-explicit-any */
import { fake, replace, restore, SinonStub, spy, stub } from 'sinon'
import { BoosterCommandDispatcher } from '../../../src/booster-command-dispatcher'
import { BoosterReadModelsReader } from '../../../src/booster-read-models-reader'
import { GraphQLGenerator } from '../../../src/services/graphql/graphql-generator'
import {
  BoosterConfig,
  ReadModelInterface,
  Level,
  EventFilterByEntity,
  EventSearchRequest,
  EventSearchResponse,
  ReadModelRequestArgs,
  ReadModelRequestProperties,
  Logger,
} from '@boostercloud/framework-types'
import { expect } from '../../expect'
import { GraphQLQueryGenerator } from '../../../src/services/graphql/graphql-query-generator'
import { GraphQLMutationGenerator } from '../../../src/services/graphql/graphql-mutation-generator'
import { GraphQLSubscriptionGenerator } from '../../../src/services/graphql/graphql-subcriptions-generator'
import { random, internet, lorem } from 'faker'
import { buildLogger } from '../../../src/booster-logger'
import { BoosterEventsReader } from '../../../src/booster-events-reader'

import { GraphQLResolverContext } from '../../../src/services/graphql/common'
import { GraphQLFieldResolver } from 'graphql'

describe('GraphQL generator', () => {
  let mockEnvironmentName: string
  let mockConfig: BoosterConfig
  let mockLogger: Logger

  beforeEach(() => {
    mockEnvironmentName = random.alphaNumeric(10)
    mockConfig = new BoosterConfig(mockEnvironmentName)
    mockLogger = buildLogger(Level.error, mockConfig)
  })

  afterEach(() => {
    restore()
  })

  describe('generateSchema', () => {
    let mockQueryTypeName: string
    let mockMutationTypeName: string
    let mockSubscriptionTypeName: string

    let fakeQueryGenerator: SinonStub
    let fakeMutationGenerator: SinonStub
    let fakeSubscriptionGenerator: SinonStub

    beforeEach(() => {
      mockQueryTypeName = random.alphaNumeric(10)
      mockMutationTypeName = random.alphaNumeric(10)
      mockSubscriptionTypeName = random.alphaNumeric(10)
      fakeQueryGenerator = stub().returns({ name: mockQueryTypeName })
      fakeMutationGenerator = stub().returns({ name: mockMutationTypeName })
      fakeSubscriptionGenerator = stub().returns({ name: mockSubscriptionTypeName })

      replace(GraphQLQueryGenerator.prototype, 'generate', fakeQueryGenerator)
      replace(GraphQLMutationGenerator.prototype, 'generate', fakeMutationGenerator)
      replace(GraphQLSubscriptionGenerator.prototype, 'generate', fakeSubscriptionGenerator)

      // Remove the schema generated by previous tests
      const generatorSingleton = GraphQLGenerator as any
      delete generatorSingleton.schema
    })

    it('should call QueryGenerator', () => {
      GraphQLGenerator.generateSchema(mockConfig, mockLogger)

      expect(fakeQueryGenerator).to.have.been.calledOnceWithExactly()
    })

    it('should call MutationGenerator', () => {
      GraphQLGenerator.generateSchema(mockConfig, mockLogger)

      expect(fakeMutationGenerator).to.have.been.calledOnceWithExactly()
    })

    it('should call SubscriptionGenerator', () => {
      GraphQLGenerator.generateSchema(mockConfig, mockLogger)

      expect(fakeSubscriptionGenerator).to.have.been.calledOnceWithExactly()
    })

    it('should return a GraphQL schema', () => {
      const result = GraphQLGenerator.generateSchema(mockConfig, mockLogger)

      const expectedTypes = {
        _queryType: {
          name: mockQueryTypeName,
        },
        _mutationType: {
          name: mockMutationTypeName,
        },
        _subscriptionType: {
          name: mockSubscriptionTypeName,
        },
      }

      expect(result).to.deep.contain(expectedTypes)
    })
  })

  describe('resolvers', () => {
    let mockType: any
    let mockRequestId: string
    let mockEmail: string
    let mockRole: string
    let mockFetchResult: Array<ReadModelInterface>
    let mockResolverContext: GraphQLResolverContext
    let mockResolverInfo: any
    let asyncIteratorStub: SinonStub
    let mockAsyncIteratorResult: string

    beforeEach(() => {
      mockType = random.arrayElement([Boolean, String, Number])
      mockRequestId = random.uuid()
      mockEmail = internet.email()
      mockRole = random.alphaNumeric(10)
      mockFetchResult = []

      for (let i = 0; i < random.number({ min: 1, max: 10 }); i++) {
        mockFetchResult.push({
          id: random.uuid(),
          testKey: random.number(),
        })
      }

      mockAsyncIteratorResult = lorem.word()
      asyncIteratorStub = stub().returns(mockAsyncIteratorResult)
      mockResolverContext = {
        requestID: mockRequestId,
        user: {
          username: mockEmail,
          roles: [mockRole],
          claims: {},
        },
        operation: {
          query: random.alphaNumeric(),
        },
        pubSub: {
          asyncIterator: (x: any) => asyncIteratorStub(x),
        },
        storeSubscriptions: false,
        context: {
          request: {
            headers: {
              authorization: 'Bearer 123',
            },
            body: {
              query: 'Test query',
            },
          },
          rawContext: {},
        },
      }
      mockResolverInfo = {}
    })

    describe('readModelResolverBuilder', () => {
      let fakeSearch: SinonStub

      let returnedFunction: GraphQLFieldResolver<any, GraphQLResolverContext, ReadModelRequestArgs<ReadModelInterface>>

      beforeEach(() => {
        fakeSearch = stub().resolves(mockFetchResult)
        replace(BoosterReadModelsReader.prototype, 'search', fakeSearch)

        returnedFunction = GraphQLGenerator.readModelResolverBuilder(mockType)
      })

      it('should call fetch with expected payload', async () => {
        const expectedFetchPayload = {
          currentUser: {
            username: mockEmail,
            roles: [mockRole],
            claims: {},
          },
          filters: {},
          requestID: mockRequestId,
          class: mockType,
          className: mockType.name,
          limit: undefined,
          afterCursor: undefined,
          paginatedVersion: false,
          version: 1,
        }

        await returnedFunction('', {}, mockResolverContext, {} as any)

        expect(fakeSearch).to.have.been.calledOnceWithExactly(expectedFetchPayload)
      })

      it('should return expected result', async () => {
        const result = await returnedFunction('', {}, mockResolverContext, mockResolverInfo)

        expect(result).to.be.deep.equal(mockFetchResult)
      })
    })

    describe('readModelByIDResolverBuilder', () => {
      class SomeReadModel {
        public constructor(readonly id: string, readonly timestamp: string) {}
      }

      context('when the read model is non sequenced', () => {
        const config = new BoosterConfig('test')

        it('builds a function that perform requests by id', async () => {
          const toReadModelByIdRequestEnvelopeSpy = spy(GraphQLGenerator as any, 'toReadModelByIdRequestEnvelope')

          const fakeFindById = fake()
          replace((GraphQLGenerator as any).readModelsReader, 'findById', fakeFindById)

          const returnedFunction = GraphQLGenerator.readModelByIDResolverBuilder(config, SomeReadModel)

          const fakeArgs = { id: '42' }
          const fakeUser = { a: 'user' }
          const fakeContext: any = { user: fakeUser, requestID: '314' }
          await returnedFunction({}, fakeArgs, fakeContext, {} as any)

          expect(toReadModelByIdRequestEnvelopeSpy).to.have.been.calledOnceWith(SomeReadModel, fakeArgs, fakeContext)

          const envelope = toReadModelByIdRequestEnvelopeSpy.returnValues[0]
          expect(envelope).to.have.property('currentUser', fakeUser)
          expect(envelope).to.have.property('requestID', '314')
          expect(envelope).to.have.property('class', SomeReadModel)
          expect(envelope).to.have.property('className', 'SomeReadModel')
          expect(envelope.key).to.be.deep.equal({ id: '42' })
          expect(envelope.key.sequenceKey).to.be.undefined
          expect(envelope).to.have.property('version', 1)

          expect(fakeFindById).to.have.been.calledOnceWith(envelope)
        })
      })

      context('when the read model is sequenced', () => {
        const config = new BoosterConfig('test')
        config.readModelSequenceKeys['SomeReadModel'] = 'timestamp'

        it('builds a function that perform requests by id and sequence key', async () => {
          const toReadModelByIdRequestEnvelopeSpy = spy(GraphQLGenerator as any, 'toReadModelByIdRequestEnvelope')

          const fakeFindById = fake()
          replace((GraphQLGenerator as any).readModelsReader, 'findById', fakeFindById)

          const returnedFunction = GraphQLGenerator.readModelByIDResolverBuilder(config, SomeReadModel)

          const fakeArgs = { id: '42', timestamp: '1000' }
          const fakeUser = { a: 'user' }
          const fakeContext: any = { user: fakeUser, requestID: '314' }
          await returnedFunction({}, fakeArgs, fakeContext, {} as any)

          expect(toReadModelByIdRequestEnvelopeSpy).to.have.been.calledOnceWith(
            SomeReadModel,
            fakeArgs,
            fakeContext,
            'timestamp'
          )

          const envelope = toReadModelByIdRequestEnvelopeSpy.returnValues[0]
          expect(envelope).to.have.property('currentUser', fakeUser)
          expect(envelope).to.have.property('requestID', '314')
          expect(envelope).to.have.property('class', SomeReadModel)
          expect(envelope).to.have.property('className', 'SomeReadModel')
          expect(envelope.key).to.be.deep.equal({ id: '42', sequenceKey: { name: 'timestamp', value: '1000' } })
          expect(envelope).to.have.property('version', 1)

          expect(fakeFindById).to.have.been.calledOnceWith(envelope)
        })
      })
    })

    describe('commandResolverBuilder', () => {
      let mockInput: any

      let dispatchCommandStub: SinonStub

      let returnedFunction: GraphQLFieldResolver<any, GraphQLResolverContext, any>

      beforeEach(() => {
        mockInput = {
          testObjectKey: random.alphaNumeric(10),
        }

        dispatchCommandStub = stub()
        replace(BoosterCommandDispatcher.prototype, 'dispatchCommand', dispatchCommandStub)

        returnedFunction = GraphQLGenerator.commandResolverBuilder(mockType)
      })

      it('should call dispatchCommand with expected input', async () => {
        await returnedFunction(
          '',
          {
            input: mockInput,
          },
          mockResolverContext,
          mockResolverInfo
        )
        expect(dispatchCommandStub).to.have.been.calledWithMatch({
          requestID: mockRequestId,
          currentUser: {
            username: mockEmail,
            roles: [mockRole],
            claims: {},
          },
          typeName: mockType.name,
          value: mockInput,
          version: 1,
          context: {
            request: {
              headers: {
                authorization: 'Bearer 123',
              },
              body: {
                query: 'Test query',
              },
            },
          },
        })
      })

      it('should return true', async () => {
        const result = await returnedFunction(
          '',
          {
            input: mockInput,
          },
          mockResolverContext,
          mockResolverInfo
        )

        expect(result).to.be.true
      })
    })

    describe('subscriptionByIDResolverBuilder', () => {
      let mockResolverResult: string

      let subscriptionResolverBuilderStub: SinonStub

      let returnedFunction: GraphQLFieldResolver<
        any,
        GraphQLResolverContext,
        ReadModelRequestProperties<ReadModelInterface>
      >

      beforeEach(() => {
        mockResolverResult = random.alphaNumeric(10)

        subscriptionResolverBuilderStub = stub().returns(() => {
          return mockResolverResult
        })
        replace(GraphQLGenerator, 'subscriptionResolverBuilder', subscriptionResolverBuilderStub)

        returnedFunction = GraphQLGenerator.subscriptionByIDResolverBuilder(mockConfig, mockType)
      })

      it('should call subscriptionResolverBuilder', async () => {
        await returnedFunction('', {}, mockResolverContext, mockResolverInfo)

        expect(subscriptionResolverBuilderStub).to.have.been.calledOnce
      })

      it('should return expected result', async () => {
        const result = await returnedFunction('', {}, mockResolverContext, mockResolverInfo)

        expect(result).to.be.equal(mockResolverResult)
      })
    })

    describe('subscriptionResolverBuilder', () => {
      let mockContextConnectionID: string
      let subscribeStub: SinonStub
      let returnedFunction: GraphQLFieldResolver<any, GraphQLResolverContext, ReadModelRequestArgs<ReadModelInterface>>

      beforeEach(() => {
        mockContextConnectionID = random.uuid()

        mockResolverContext.connectionID = mockContextConnectionID

        subscribeStub = stub().resolves()

        replace(BoosterReadModelsReader.prototype, 'subscribe', subscribeStub)

        returnedFunction = GraphQLGenerator.subscriptionResolverBuilder(mockConfig, mockType)
      })

      context('missing context.connectionID', () => {
        it('should throw an error', async () => {
          mockResolverContext.connectionID = undefined

          let error: Error = new Error()

          try {
            await returnedFunction('', {}, mockResolverContext, mockResolverInfo)
          } catch (e) {
            error = e
          } finally {
            expect(error.message).to.be.equal('Missing "connectionID". It is required for subscriptions')
          }
        })
      })

      context('storeSubscriptions', () => {
        describe('should storeSubscriptions', () => {
          it('should call readModelsDispatcher.subscribe', async () => {
            mockResolverContext.storeSubscriptions = true

            await returnedFunction('', {}, mockResolverContext, mockResolverInfo)

            expect(subscribeStub).to.be.calledOnce
          })
        })

        describe('should not storeSubscriptions', () => {
          it('should not call readModelsDispatcher.subscribe', async () => {
            mockResolverContext.storeSubscriptions = false

            await returnedFunction('', {}, mockResolverContext, mockResolverInfo)

            expect(subscribeStub).to.not.be.called
          })
        })
      })

      it('should call pubsub.asyncIterator', async () => {
        await returnedFunction('', {}, mockResolverContext, mockResolverInfo)

        expect(asyncIteratorStub).to.be.calledOnceWithExactly({
          currentUser: {
            username: mockEmail,
            roles: [mockRole],
            claims: {},
          },
          filters: {},
          requestID: mockRequestId,
          class: mockType,
          className: mockType.name,
          limit: undefined,
          afterCursor: undefined,
          paginatedVersion: false,
          version: 1,
        })
      })

      it('should return expected result', async () => {
        const result = await returnedFunction('', {}, mockResolverContext, mockResolverInfo)

        expect(result).to.be.equal(mockAsyncIteratorResult)
      })
    })

    describe('eventResolver', () => {
      let fetchEventsStub: SinonStub
      const fetchEventsResult: Array<EventSearchResponse> = []
      const filters: EventFilterByEntity = {
        entity: 'TestEntity',
      }

      beforeEach(() => {
        fetchEventsStub = stub().resolves(fetchEventsResult)
        replace(BoosterEventsReader.prototype, 'fetch', fetchEventsStub)
      })

      it('should call fetch with expected payload', async () => {
        const expectedFetchEventsPayload: EventSearchRequest = {
          currentUser: {
            username: mockEmail,
            roles: [mockRole],
            claims: {},
          },
          filters,
          requestID: mockRequestId,
        }

        await GraphQLGenerator.eventResolver('', filters, mockResolverContext, {} as never)

        expect(fetchEventsStub).to.have.been.calledOnceWithExactly(expectedFetchEventsPayload)
      })

      it('should return expected result', async () => {
        const result = await GraphQLGenerator.eventResolver('', filters, mockResolverContext, {} as never)

        expect(result).to.be.deep.equal(fetchEventsResult)
      })
    })
  })
})
