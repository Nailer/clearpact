export const ClearPactEscrowAbi = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "_arbiter",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "_registry",
        "type": "address",
        "internalType": "contract ReputationRegistry"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "acceptDelivery",
    "inputs": [
      {
        "name": "jobId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "arbiter",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "arbitrate",
    "inputs": [
      {
        "name": "jobId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "workerBps",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "slashBps",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "cancelExpired",
    "inputs": [
      {
        "name": "jobId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "createJob",
    "inputs": [
      {
        "name": "worker",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "verifier",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "specHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "passScore",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "deadline",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "disputeWindow",
        "type": "uint32",
        "internalType": "uint32"
      },
      {
        "name": "minWorkerStake",
        "type": "uint96",
        "internalType": "uint96"
      }
    ],
    "outputs": [
      {
        "name": "jobId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "payable"
  },
  {
    "type": "function",
    "name": "deliver",
    "inputs": [
      {
        "name": "jobId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "deliverableHash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "dispute",
    "inputs": [
      {
        "name": "jobId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "getJob",
    "inputs": [
      {
        "name": "jobId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct ClearPactEscrow.Job",
        "components": [
          {
            "name": "buyer",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "worker",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "verifier",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "amount",
            "type": "uint96",
            "internalType": "uint96"
          },
          {
            "name": "specHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "deliverableHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "verdictHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "deadline",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "disputeWindow",
            "type": "uint32",
            "internalType": "uint32"
          },
          {
            "name": "verdictAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "score",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "passScore",
            "type": "uint8",
            "internalType": "uint8"
          },
          {
            "name": "status",
            "type": "uint8",
            "internalType": "enum ClearPactEscrow.Status"
          },
          {
            "name": "minWorkerStake",
            "type": "uint96",
            "internalType": "uint96"
          },
          {
            "name": "lockedStake",
            "type": "uint96",
            "internalType": "uint96"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "jobs",
    "inputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "buyer",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "worker",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "verifier",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint96",
        "internalType": "uint96"
      },
      {
        "name": "specHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "deliverableHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "verdictHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "deadline",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "disputeWindow",
        "type": "uint32",
        "internalType": "uint32"
      },
      {
        "name": "verdictAt",
        "type": "uint64",
        "internalType": "uint64"
      },
      {
        "name": "score",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "passScore",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "status",
        "type": "uint8",
        "internalType": "enum ClearPactEscrow.Status"
      },
      {
        "name": "minWorkerStake",
        "type": "uint96",
        "internalType": "uint96"
      },
      {
        "name": "lockedStake",
        "type": "uint96",
        "internalType": "uint96"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "nextJobId",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "registry",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract ReputationRegistry"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "settle",
    "inputs": [
      {
        "name": "jobId",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "submitVerdict",
    "inputs": [
      {
        "name": "jobId",
        "type": "uint256",
        "internalType": "uint256"
      },
      {
        "name": "score",
        "type": "uint8",
        "internalType": "uint8"
      },
      {
        "name": "verdictHash",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "event",
    "name": "JobArbitrated",
    "inputs": [
      {
        "name": "jobId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "workerAmount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "buyerAmount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "slashedAmount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "JobCreated",
    "inputs": [
      {
        "name": "jobId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "buyer",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "worker",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "verifier",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      },
      {
        "name": "specHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "deadline",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      },
      {
        "name": "disputeWindow",
        "type": "uint32",
        "indexed": false,
        "internalType": "uint32"
      },
      {
        "name": "passScore",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "JobDisputed",
    "inputs": [
      {
        "name": "jobId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "by",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "JobRefunded",
    "inputs": [
      {
        "name": "jobId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "buyer",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "JobReleased",
    "inputs": [
      {
        "name": "jobId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "worker",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "amount",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "VerdictSubmitted",
    "inputs": [
      {
        "name": "jobId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "score",
        "type": "uint8",
        "indexed": false,
        "internalType": "uint8"
      },
      {
        "name": "passed",
        "type": "bool",
        "indexed": false,
        "internalType": "bool"
      },
      {
        "name": "verdictHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "WorkDelivered",
    "inputs": [
      {
        "name": "jobId",
        "type": "uint256",
        "indexed": true,
        "internalType": "uint256"
      },
      {
        "name": "deliverableHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "BadParams",
    "inputs": []
  },
  {
    "type": "error",
    "name": "DeadlinePassed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "DisputeWindowClosed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "DisputeWindowOpen",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotAuthorized",
    "inputs": []
  },
  {
    "type": "error",
    "name": "TransferFailed",
    "inputs": []
  },
  {
    "type": "error",
    "name": "WrongStatus",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ZeroAddress",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ZeroAmount",
    "inputs": []
  }
] as const;
