import { ethers } from "ethers";
import {
  type BigNumberish,
  type BytesLike,
  type TypedDataDomain,
  type TypedDataField,
} from "ethers";

type EIP712Domain = {
  name?: string | null;
  version?: string | null;
  chainId?: BigNumberish | null;
  verifyingContract?: string | null;
  salt?: BytesLike | null;
};

type EIP712DomainParameters = {
  name: string;
  version: string;
  chainId: BigNumberish;
  verifyingContract: string;
  salt: BytesLike;
  usedParamsMask: number;
};

export type PopulatedTypedData = {
  domain: TypedDataDomain;
  types: Record<string, TypedDataField[]>;
  primaryType: string;
  message: Record<string, any>;
};

export function getDomainParams(domain: EIP712Domain): EIP712DomainParameters {
  let usedParamsMask: number = 0;
  const domainParameterNames: (keyof EIP712Domain)[] = [
    "name",
    "version",
    "chainId",
    "verifyingContract",
    "salt",
  ];
  for (const [i, domainParameterName] of domainParameterNames.entries()) {
    if (
      Object.keys(domain).includes(domainParameterName) &&
      domain[domainParameterName] !== undefined &&
      domain[domainParameterName] !== null
    ) {
      usedParamsMask |= 1 << i;
    }
  }

  return {
    name: domain.name ?? "",
    version: domain.version ?? "",
    chainId: domain.chainId ?? 0n,
    verifyingContract: domain.verifyingContract ?? "0x0000000000000000000000000000000000000000",
    salt: domain.salt ?? "0x0000000000000000000000000000000000000000000000000000000000000000",
    usedParamsMask,
  };
}

export function getTypedDataParams(typedData: PopulatedTypedData): {
  typeString: string;
  encodedData: string;
  domainParams: EIP712DomainParameters;
} {
  const typedDataEnc = ethers.TypedDataEncoder.from(typedData.types);
  const typeString = typedDataEnc.encodeType(typedData.primaryType);
  const encodedData = ethers.dataSlice(
    typedDataEnc.encodeData(typedData.primaryType, typedData.message),
    32,
  );
  const domainParameters = getDomainParams(typedData.domain);
  return {
    typeString,
    encodedData,
    domainParams: domainParameters,
  };
}
