import { TezosToolkit } from '@taquito/taquito'
import BigNumber from 'bignumber.js'
import { Token } from '../tokens/token'
import { Exchange } from './exchange'

export class QuipuswapExchange extends Exchange {
  public exchangeUrl: string = 'https://quipuswap.com'
  public exchangeId: string = ``
  public name: string = 'Quipuswap'
  public logo: string = 'quipuswap_logo.svg'

  public TOKEN_DECIMALS = 12
  public TEZ_DECIMALS = 6

  public QUIPUSWAP_FEE: number = 0.997

  constructor(tezos: TezosToolkit, dexAddress: string, token1: Token, token2: Token) {
    super(tezos, dexAddress, token1, token2)
  }

  public async token1ToToken2(tokenAmount: number, minimumReceived: number): Promise<string> {
    if (this.token1.symbol === 'tez') {
      return this.tezToTokenSwap(tokenAmount, minimumReceived)
    } else {
      return this.tokenToTezSwap(tokenAmount, minimumReceived)
    }
  }

  public async token2ToToken1(tokenAmount: number, minimumReceived: number): Promise<string> {
    if (this.token2.symbol === 'tez') {
      return this.tezToTokenSwap(tokenAmount, minimumReceived)
    } else {
      return this.tokenToTezSwap(tokenAmount, minimumReceived)
    }
  }

  public async getToken1MaximumExchangeAmount(): Promise<BigNumber> {
    if (this.token1.symbol === 'tez') {
      return this.getExchangeMaximumTezAmount()
    }
    return this.getExchangeMaximumTokenAmount()
  }

  public async getToken2MaximumExchangeAmount(): Promise<BigNumber> {
    if (this.token2.symbol === 'tez') {
      return this.getExchangeMaximumTezAmount()
    }
    return this.getExchangeMaximumTokenAmount()
  }

  public async getExchangeRate(): Promise<BigNumber> {
    const dexContract = await this.getContractWalletAbstraction(this.dexAddress)
    const storage = (await this.getStorageOfContract(dexContract)) as any
    return new BigNumber(storage['storage']['token_pool'])
      .dividedBy(10 ** this.TOKEN_DECIMALS)
      .dividedBy(new BigNumber(storage['storage']['tez_pool']).dividedBy(10 ** this.TEZ_DECIMALS))
  }

  public async getToken1Balance(): Promise<BigNumber> {
    if (this.token1.symbol === 'tez') {
      return this.getTezBalance()
    }
    return this.getTokenAmount(this.token1.contractAddress, await this.getOwnAddress(), Number(this.token1.tokenId))
  }

  public async getToken2Balance(): Promise<BigNumber> {
    if (this.token2.symbol === 'tez') {
      return this.getTezBalance()
    }
    return this.getTokenAmount(this.token2.contractAddress, await this.getOwnAddress(), Number(this.token2.tokenId))
  }

  public async getExpectedMinimumReceivedToken1(token2Amount: number): Promise<BigNumber> {
    if (this.token1.symbol === 'tez') {
      return this.getExpectedMinimumReceivedTez(token2Amount)
    }
    return this.getExpectedMinimumReceivedToken(token2Amount)
  }

  public async getExpectedMinimumReceivedToken2(token1Amount: number): Promise<BigNumber> {
    if (this.token2.symbol === 'tez') {
      return this.getExpectedMinimumReceivedTez(token1Amount)
    }
    return this.getExpectedMinimumReceivedToken(token1Amount)
  }

  private async getTezBalance(): Promise<BigNumber> {
    return this.tezos.tz.getBalance(await this.getOwnAddress())
  }

  private async getExchangeMaximumTokenAmount(): Promise<BigNumber> {
    const dexContract = await this.getContractWalletAbstraction(this.dexAddress)
    const storage = (await this.getStorageOfContract(dexContract)) as any
    const currentTokenPool = new BigNumber(storage['storage']['token_pool'])
    return currentTokenPool.dividedBy(3)
  }

  private async getExchangeMaximumTezAmount(): Promise<BigNumber> {
    const dexContract = await this.getContractWalletAbstraction(this.dexAddress)
    const storage = (await this.getStorageOfContract(dexContract)) as any
    const currentTezPool = new BigNumber(storage['storage']['tez_pool'])
    return currentTezPool.dividedBy(3)
  }

  public async tezToTokenSwap(amountInMutez: number, minimumReceived: number): Promise<string> {
    const source = await this.getOwnAddress()
    const dexContract = await this.getContractWalletAbstraction(this.dexAddress)
    return this.sendAndAwait(
      this.tezos.wallet
        .batch()
        .withTransfer(
          dexContract.methods.tezToTokenPayment(minimumReceived, source).toTransferParams({ amount: amountInMutez, mutez: true })
        )
    )
  }

  public async tokenToTezSwap(tokenAmount: number, minimumReceived: number): Promise<string> {
    const source = await this.getOwnAddress()
    const dexContract = await this.getContractWalletAbstraction(this.dexAddress)
    const dexStorage = (await this.getStorageOfContract(dexContract)) as any

    const tokenAddress = dexStorage['storage']['token_address']
    const tokenId = dexStorage['storage']['token_id']

    return this.sendAndAwait(
      this.tezos.wallet
        .batch()
        .withContractCall(await this.prepareAddTokenOperator(tokenAddress, this.dexAddress, tokenId))
        .withContractCall(dexContract.methods.tokenToTezPayment(tokenAmount, minimumReceived, source))
        .withContractCall(await this.prepareRemoveTokenOperator(tokenAddress, this.dexAddress, tokenId))
    )
  }

  public async getExpectedMinimumReceivedToken(amountInMutez: number): Promise<BigNumber> {
    const dexContract = await this.getContractWalletAbstraction(this.dexAddress)
    const storage = (await this.getStorageOfContract(dexContract)) as any
    const currentTokenPool = new BigNumber(storage['storage']['token_pool'])
    const currentTezPool = new BigNumber(storage['storage']['tez_pool'])
    const constantProduct = currentTokenPool.multipliedBy(currentTezPool)
    const remainingTokenPoolAmount = constantProduct.dividedBy(currentTezPool.plus(amountInMutez * this.QUIPUSWAP_FEE))
    return currentTokenPool.minus(remainingTokenPoolAmount)
  }

  public async getExpectedMinimumReceivedTez(tokenAmount: number): Promise<BigNumber> {
    const dexContract = await this.getContractWalletAbstraction(this.dexAddress)
    const storage = (await this.getStorageOfContract(dexContract)) as any
    const currentTokenPool = new BigNumber(storage['storage']['token_pool'])
    const currentTezPool = new BigNumber(storage['storage']['tez_pool'])
    const constantProduct = currentTokenPool.multipliedBy(currentTezPool)
    const remainingTezPoolAmount = constantProduct.dividedBy(currentTokenPool.plus(tokenAmount * this.QUIPUSWAP_FEE))
    return currentTezPool.minus(remainingTezPoolAmount)
  }

  public async getExchangeUrl(): Promise<string> {
    const from = this.token1.symbol === 'tez' ? 'tez' : `${this.token1.contractAddress}_${this.token1.tokenId}`
    const to = this.token2.symbol === 'tez' ? 'tez' : `${this.token2.contractAddress}_${this.token2.tokenId}`
    return `https://quipuswap.com/swap?from=${from}&to=${to}`
  }
}