// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

/**
 * @dev Describes an EIP-712 domain
 */
struct EIP712DomainParams {
    string name;
    string version;
    uint256 chainId;
    address verifyingContract;
    bytes32 salt;
    uint256 usedParamsMask;
}

/**
 * @title EIP-712 Utils
 * @dev Utility functions for generating and verifying EIP-712 signatures
 */
library EIP712Utils {
    function getEIP712Type(uint256 usedParams) public pure returns (string memory) {
        string[5] memory domainParams = [
            "string name",
            "string version",
            "uint256 chainId",
            "address verifyingContract",
            "bytes32 salt"
        ];
        string memory result = "EIP712Domain(";
        bool hasParam = false;
        for (uint256 i = 0; i < 5; i++) {
            if (usedParams & (1 << i) != 0) {
                if (hasParam) {
                    result = string.concat(result, ",");
                }
                result = string.concat(result, domainParams[i]);
                hasParam = true;
            }
        }
        result = string.concat(result, ")");
        return result;
    }

    /**
     * @dev Returns the domain separator for EIP-712 typehash
     * @param params EIP-712 domain parameters
     * @return bytes32 domain separator
     */
    function buildDomainSeparator(EIP712DomainParams memory params) public pure returns (bytes32) {
        bytes memory domainSeparator = bytes.concat(keccak256(bytes(getEIP712Type(params.usedParamsMask))));
        if (params.usedParamsMask & 0x1 != 0) {
            domainSeparator = bytes.concat(domainSeparator, keccak256(bytes(params.name)));
        }
        if (params.usedParamsMask & 0x2 != 0) {
            domainSeparator = bytes.concat(domainSeparator, keccak256(bytes(params.version)));
        }
        if (params.usedParamsMask & 0x4 != 0) {
            domainSeparator = bytes.concat(domainSeparator, abi.encode(params.chainId));
        }
        if (params.usedParamsMask & 0x8 != 0) {
            domainSeparator = bytes.concat(domainSeparator, abi.encode(params.verifyingContract));
        }
        if (params.usedParamsMask & 0x10 != 0) {
            domainSeparator = bytes.concat(domainSeparator, params.salt);
        }
        return keccak256(domainSeparator);
    }

    function hashStruct(string calldata typeSig, bytes calldata encodedData) public pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(bytes(typeSig)), encodedData));
    }

    function getTypedDataHash(
        EIP712DomainParams memory params,
        string calldata typeSig,
        bytes calldata encodedData
    ) public pure returns (bytes32) {
        return keccak256(bytes.concat(hex"19_01", buildDomainSeparator(params), hashStruct(typeSig, encodedData)));
    }
}
