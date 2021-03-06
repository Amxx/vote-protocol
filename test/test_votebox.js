const assert = require('assert');
const BigNumber = require('bignumber.js');
const {
    toWad,
    fromWad,
    createEVMSnapshot,
    restoreEVMSnapshot,
    increaseEvmBlock
} = require('./funcs');

const TestToken = artifacts.require('test/TestToken.sol');
const VoteBox = artifacts.require('VoteBox.sol');

contract('votebox', accounts => {
    let snapshotId;
    let mcb;
    let voteBox;
    const u1 = accounts[4];
    const u2 = accounts[5];
    const u3 = accounts[6];

    beforeEach(async () => {
        snapshotId = await createEVMSnapshot();
        mcb = await TestToken.new("MCB", "Test MCB");
        voteBox = await VoteBox.new(mcb.address);
    });

    afterEach(async function () {
        await restoreEVMSnapshot(snapshotId);
    });

    async function defaultActiveBlock() {
        const beginBlock = 1 /* next block */ + (await web3.eth.getBlockNumber());
        const endBlock = beginBlock + 6336; // 1.1 days for 15s/block
        return { beginBlock, endBlock };
    }

    describe("propose", async () => {
        it("insufficient mcb", async () => {
            try {
                const { beginBlock, endBlock } = await defaultActiveBlock();
                await voteBox.propose("https://", beginBlock, endBlock, { from: u1 });
                throw null;
            } catch (error) {
                assert.ok(error.message.includes("proposal privilege required"), error);
            }  
        });

        it("insufficient mcb", async () => {
            await mcb.mint(u1, '19999' + '999999999999999999');
            try {
                const { beginBlock, endBlock } = await defaultActiveBlock();
                await voteBox.propose("https://", beginBlock, endBlock, { from: u1 });
                throw null;
            } catch (error) {
                assert.ok(error.message.includes("proposal privilege required"), error);
            }  
        });

        describe("with proposal privilege", async () => {
            beforeEach(async () => {
                await mcb.mint(u1, toWad('20000'));
            });
        
            it("normal", async () => {
                const { beginBlock, endBlock } = await defaultActiveBlock();
                assert.equal(await voteBox.totalProposals(), 0);

                await voteBox.propose("https://", beginBlock, endBlock, { from: u1 });
                assert.equal(await voteBox.totalProposals(), 1);
                const meta0 = await voteBox.proposals(0);
                assert.equal(meta0.link, "https://");
                assert.equal(meta0.beginBlock, beginBlock);
                assert.equal(meta0.endBlock, endBlock);

                await voteBox.propose("https://", beginBlock + 1, endBlock, { from: u1 });
                assert.equal(await voteBox.totalProposals(), 2);
                const meta1 = await voteBox.proposals(1);
                assert.equal(meta1.link, "https://");
                assert.equal(meta1.beginBlock, beginBlock + 1);
                assert.equal(meta1.endBlock, endBlock);
            });

            it("wrong link", async () => {
                try {
                    const { beginBlock, endBlock } = await defaultActiveBlock();
                    await voteBox.propose("", beginBlock, endBlock, { from: u1 });
                    throw null;
                } catch (error) {
                    assert.ok(error.message.includes("empty link"), error);
                }
            });

            it("wrong time", async () => {
                try {
                    const { beginBlock, endBlock } = await defaultActiveBlock();
                    await voteBox.propose("https://", beginBlock - 1, endBlock, { from: u1 });
                    throw null;
                } catch (error) {
                    assert.ok(error.message.includes("old proposal"), error);
                }
                try {
                    const { beginBlock } = await defaultActiveBlock();
                    await voteBox.propose("https://", beginBlock, beginBlock, { from: u1 });
                    throw null;
                } catch (error) {
                    assert.ok(error.message.includes("period is too short"), error);
                }
            });
        }); // with with proposal privilege
    }); // propose

    describe("vote", async () => {
        it("vote before create", async () => {
            try {
                await voteBox.vote(0, 0, { from: u2 });
                throw null;
            } catch (error) {
                assert.ok(error.message.includes("invalid id"), error);
            }
        });

        describe("proposal created", async () => {
            beforeEach(async () => {
                await mcb.mint(u1, toWad('20000'));
                const { beginBlock, endBlock } = await defaultActiveBlock();
                await voteBox.propose("https://", beginBlock, endBlock, { from: u1 });
                await voteBox.propose("https://", beginBlock + 20, endBlock + 20, { from: u1 });
            });

            it("normal votes", async () => {
                // enable both proposals
                for (let i = 0; i < 20; i++) {
                    await increaseEvmBlock();
                }
                assert(await voteBox.votes(0, u1), 0)
                assert(await voteBox.votes(0, u2), 0)
                assert(await voteBox.votes(0, u3), 0)
                assert(await voteBox.votes(1, u1), 0)
                assert(await voteBox.votes(1, u2), 0)
                assert(await voteBox.votes(1, u3), 0)
                
                // set
                await voteBox.vote(0, 1, { from: u1 });
                await voteBox.vote(0, 2, { from: u2 });
                await voteBox.vote(1, 2, { from: u3 });
                assert(await voteBox.votes(0, u1), 1);
                assert(await voteBox.votes(0, u2), 2);
                assert(await voteBox.votes(1, u3), 2);

                // overwrite
                await voteBox.vote(0, 1, { from: u2 });
                assert(await voteBox.votes(0, u1), 1);
                assert(await voteBox.votes(0, u2), 1);
                assert(await voteBox.votes(1, u3), 2);
            });

            it("invalid vote data", async () => {
                try {
                    await voteBox.vote(0, 0, { from: u2 });
                    throw null;
                } catch (error) {
                    assert.ok(error.message.includes("invalid content"), error);
                }
                try {
                    await voteBox.vote(0, 3, { from: u2 });
                    throw null;
                } catch (error) {
                    assert.ok(error.message.includes("invalid opcode"), error);
                }
            });

            it("out of time range", async () => {
                try {
                    await voteBox.vote(1, 1, { from: u2 });
                    throw null;
                } catch (error) {
                    assert.ok(error.message.includes("< begin"), error);
                }

                // skip 1.1 days for 15s/block
                for (let i = 0; i < 6336; i++) {
                    await increaseEvmBlock();
                }

                try {
                    await voteBox.vote(0, 1, { from: u2 });
                    throw null;
                } catch (error) {
                    assert.ok(error.message.includes("> end"), error);
                }
            });
        }); // proposal created
    }); // vote
});
