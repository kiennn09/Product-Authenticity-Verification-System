const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const net = hre.network.name;
  console.log(`Network   : ${net}`);
  console.log(`Deployer  : ${deployer.address}`);
  console.log(`Balance   : ${hre.ethers.formatEther(await hre.ethers.provider.getBalance(deployer.address))} ETH`);

  const Factory = await hre.ethers.getContractFactory("ProductAuthenticity");
  const contract = await Factory.deploy();
  const receipt = await contract.deploymentTransaction().wait();
  const address = await contract.getAddress();
  console.log(`Contract  : ${address}`);
  console.log(`Tx hash   : ${receipt.hash}`);
  console.log(`Block     : ${receipt.blockNumber}`);

  // Ghi địa chỉ + ABI cho backend và frontend
  const artifact = await hre.artifacts.readArtifact("ProductAuthenticity");
  const info = {
    network: net,
    chainId: Number((await hre.ethers.provider.getNetwork()).chainId),
    address,
    deployBlock: receipt.blockNumber,
    deployTx: receipt.hash,
    deployer: deployer.address,
    abi: artifact.abi,
  };
  for (const dir of ["../backend/src", "../frontend/src"]) {
    const out = path.join(__dirname, "..", dir);
    if (fs.existsSync(out)) {
      fs.writeFileSync(path.join(out, `contract.${net}.json`), JSON.stringify(info, null, 2));
      console.log(`Saved     : ${dir}/contract.${net}.json`);
    }
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
