/**
 * Shadowdark Enhancer — Sealed Content
 *
 * Ships finished, verified content documents inside the module WITHOUT
 * shipping readable rules text: each unit (a class + its talents + tables)
 * is AES-GCM encrypted with a key derived from anchor phrases of the book
 * section it came from. Pasting that section proves ownership: the anchors
 * are located in the normalized paste (the module stores only their hashes
 * and token lengths), the key is derived from the paste's own words, and the
 * pre-authored documents decrypt and import with links remapped.
 *
 * See .planning/CHAR-CONTENT-UNLOCK-SPEC.md ("sealed content" pivot).
 *
 * Payload doc conventions:
 *   - intra-unit links are "@@LOCAL:<index>@@" tokens (index into payload.docs)
 *   - system-compendium links (shadowdark.*) are kept literal — those uuids
 *     are identical in every world.
 */

import { MODULE_ID } from "../module-id.mjs";

/** Registry of sealed units shipped under data/locked/. Metadata only. */
export const SEALED_UNITS = [
  {
    id: "wr-delver",
    name: "Delver",
    type: "Class",
    source: "WR",
    pages: "38",
    file: `modules/${MODULE_ID}/data/locked/wr-delver.json`,
    // anchor token-lengths + SHA-256 of each normalized anchor (order matters)
    anchors: [
      { len: 11, hash: "a99a161644209c94688a2bc968ce6450e74413afc27567ebc635c25f9bc27d63" },
      { len: 12, hash: "b0aacdd776112ed7b16aeb69eace790dde0346a2b99f0cb1e3eccc8fd22762b5" },
      { len: 7, hash: "d46408f4dd1c0960517626e1fafbef61ed882bd608bf4c7b09f8952d843d3b39" },
      { len: 6, hash: "21e31306b130f26170c8da2e44f10ff1d7c72722bb148a84cac25c86859983fe" },
      { len: 9, hash: "b9fdf3afe3044e08bbc0fb3f40b0fe699ddbcb530b4e8b65b5d8b7d4b4fdd6e6" },
    ],
  },
  {
    id: "wr-duelist",
    name: "Duelist",
    type: "Class",
    source: "WR",
    pages: "42",
    file: `modules/${MODULE_ID}/data/locked/wr-duelist.json`,
    anchors: [
      { len: 12, hash: "d208c9722e48fddc4e5dbe709f40e6e8ac565497b8033f0e07cdeb06077ecfcd" },
      { len: 11, hash: "3ce37ffc717f139667049874524a7b3a7a41cf6c3acda2163c17bad22262feab" },
      { len: 12, hash: "451eb03c5d82075f03ac2e4ee017511dc883b6a9ba48f643256383abaf50d0c1" },
      { len: 9, hash: "8aa2b4560f59c20c932a31e86a14d5e2ac38423af6f84b344bcc0a62859cdd9a" },
      { len: 10, hash: "c9254b5b8305cf081884afef847480fe961e20840d211398b68b1c79a86caeb6" },
    ],
  },
  {
    id: "wr-green-knight",
    name: "Green Knight",
    type: "Class",
    source: "WR",
    pages: "44",
    file: `modules/${MODULE_ID}/data/locked/wr-green-knight.json`,
    anchors: [
      { len: 7, hash: "30a7b58e7705e27d088c077e7bcf71b8f95ccdb0b9081cf94ad2c12209870609" },
      { len: 5, hash: "b8e815d50b3da2ed0c7a3aecb1a45f86eaa443c880563b5a26619783ebacc565" },
      { len: 10, hash: "a8fdfdcf1e7a409108349afa956076b83d118c9fb644f48b89bd7e83b21e55ba" },
      { len: 7, hash: "5a9fdbb7c8c6bb5ac4a874d4789e07392f92d4980a15e9aaa71eec69b94c9b53" },
      { len: 8, hash: "b50949c34d7925102a736e201d1d26c65a7ddb43bc450ec3e6a11ee60e753fdf" },
    ],
  },
  {
    id: "wr-kyzian-archer",
    name: "Kyzian Archer",
    type: "Class",
    source: "WR",
    pages: "49",
    file: `modules/${MODULE_ID}/data/locked/wr-kyzian-archer.json`,
    anchors: [
      { len: 11, hash: "0aad93075cf732a56d10da8284df97a5e72ebad39e5794c98f4fde4254a0a4c3" },
      { len: 7, hash: "5f5c14a02c978fbf2fa46606669e6d1ffe79369cc125a60c45e48539024696e7" },
      { len: 11, hash: "7d1ce44ad407ec3dd3fa92819357ab36cb575324a1057c39f542c2d72ce3535d" },
      { len: 8, hash: "f1caa604d3c38633b167bf123f53627dd688596befdc0c05bb284521ef99f977" },
      { len: 11, hash: "a01600dfaaa7c7407802be0f8119260901af814f8856d90b24bad587e1ea3c19" },
    ],
  },
  {
    id: "wr-monk-of-yag-kesh",
    name: "Monk of Yag-Kesh",
    type: "Class",
    source: "WR",
    pages: "50",
    file: `modules/${MODULE_ID}/data/locked/wr-monk-of-yag-kesh.json`,
    anchors: [
      { len: 7, hash: "792aed03547d561004b4bbda41b3e49aae14da0c1e7e9924c29c6772efdbbd29" },
      { len: 8, hash: "243a6bcad6447f380cbcfc987e30781d05a29517af2d712f8ad04d2a757fa7d0" },
      { len: 11, hash: "f495da375611655ae23d57e486a876a4f4a60754f744eb64163f22e46527298a" },
      { len: 11, hash: "b34ad28094a742a91ae9018200905f72a06b7a372a19b09bd2f6ccab2dcb90ff" },
      { len: 13, hash: "4d2b82a2a1f20274db1d64f18cff9a534ed855b66b83a5c962fc913c1caac546" },
    ],
  },
  {
    id: "wr-paladin",
    name: "Paladin",
    type: "Class",
    source: "WR",
    pages: "54",
    file: `modules/${MODULE_ID}/data/locked/wr-paladin.json`,
    anchors: [
      { len: 10, hash: "46b132bcbf5124b083d48010a2e5c53659f965bfa225baebe5fcedf81b9da91a" },
      { len: 9, hash: "94b6afba371a5b75dffef8e9a4aadcecf6a192ec47b0ef5aa48d8eb8c5f90c82" },
      { len: 14, hash: "4f06d60e363f50308fe50c30b45bbcfe63db0c1d696c3972497367ba928f93e5" },
      { len: 10, hash: "d7a5ef3315fc146a4f83eb3c97f6eb8341e251bcad903eb359e4dd617e6d3578" },
      { len: 10, hash: "bf9ec58c033f4ab9c23ec3aad1161c33dc143739cb64ae92521bd8fd2954419d" },
    ],
  },
  {
    id: "wr-roustabout",
    name: "Roustabout",
    type: "Class",
    source: "WR",
    pages: "63",
    file: `modules/${MODULE_ID}/data/locked/wr-roustabout.json`,
    anchors: [
      { len: 6, hash: "63be1ffc7c3709ce796fd8cc0c0781dc9bfabdb235beb36c0c2d43a52469c8ad" },
      { len: 13, hash: "629005fb3b71afa31b1d1885309a2e3a95a533b26c2c4b133e78c42d89a76551" },
      { len: 13, hash: "2020a09ddf6bdc377719ff088f0cab6471084e2aaf88fcab84d26317e475eb4d" },
      { len: 14, hash: "3fbf75911bed462211c1afe16aa5703f323c682bc5b0096a3af0153944954b84" },
      { len: 17, hash: "099c3c348baac1f4220395fc0323b8b9d905136e78c602e7d002bfc2ba82085c" },
    ],
  },
  {
    id: "wr-wyrdling",
    name: "Wyrdling",
    type: "Class",
    source: "WR",
    pages: "72",
    file: `modules/${MODULE_ID}/data/locked/wr-wyrdling.json`,
    anchors: [
      { len: 9, hash: "8a36464d56bc23b6a8333aedc747e9fa00e504a73ff65f728dc96cd48e9e927e" },
      { len: 8, hash: "319c39db7d81c385d41469b2b84c09b7c098f4e04433d9657c2c5e1a34baecc2" },
      { len: 12, hash: "34c7890b06908c66ddc055ea25cab63dc54a0bf5707f65d465f936bdf3ab1856" },
      { len: 10, hash: "9baa39946b5a2daa3f8f25fe9ec0acfd61e67c5b708f210776ef16f9432d0c87" },
      { len: 5, hash: "65135647e1c0173491c0c9e739ebb88fa8a874709ed6758db656dc460b4341e4" },
    ],
  },
  {
    id: "wr-necromancer",
    name: "Necromancer",
    type: "Class",
    source: "WR",
    pages: "52",
    file: `modules/${MODULE_ID}/data/locked/wr-necromancer.json`,
    anchors: [
      { len: 11, hash: "b1f8d610985b36527710710dfd291b9a5e31bee40a17ef5680ee1b49358e1ca4" },
      { len: 10, hash: "fe85f193b73b198b07a402ec2de7cdf5dd60723f3db2bfa234b9b2e067b6c54b" },
      { len: 13, hash: "5c7dc31a32988153fbbbf50ba71cadfab27c7179f9a9026ac053cbf0e430c50a" },
      { len: 16, hash: "68270a65181ba455cac6d5676fa858f6f100dbcdc046229d47503b2fefdf8f3f" },
      { len: 7, hash: "7cccbeb7627b388fcda0cd4b3283e13383e4fa95bf5dcb2b8432577bba459812" },
    ],
  },
  {
    id: "wr-backgrounds",
    name: "Backgrounds",
    type: "Background",
    coversType: "Background",   // any locked Background entry unlocks the whole set
    source: "WR",
    pages: "74",
    file: `modules/${MODULE_ID}/data/locked/wr-backgrounds.json`,
    anchors: [
      { len: 10, hash: "f232a295cb82f417f8da7de2fd89d5b62870d63e64e445e7d358d97cf7c69925" },
      { len: 9, hash: "ab2bac79ca6fe2ee9e9d7f674a02a20b30242e4e1f76a02a38a05ef9a9ba198d" },
      { len: 10, hash: "58eaf31d452d2108f30803c2a9c2f131789afbeda80305fd3fc9be5557256dad" },
      { len: 10, hash: "aa791fd181a872c02c92a17c7714a82a6c9d570f52f79057bcde17424a25e21e" },
      { len: 7, hash: "cbd3d57706de5a16368eceed905bd88a118da375d1f5a55ea39c35cff5826dc4" },
    ],
  },
  {
    id: "cs4-spells",
    name: "Cursed Scroll 4 Spells",
    type: "Spell",
    coversType: "Spell",   // any locked CS4 Spell (src CS4) unlocks the set
    source: "CS4",
    pages: "14-16",
    file: `modules/${MODULE_ID}/data/locked/cs4-spells.json`,
    anchors: [
      { len: 7, hash: "6032dc8108c9729a98f8e32bd676b5d3da1998aa882421c6e341ba29d69e3017" },
      { len: 7, hash: "f0fa9c50001ff77f58bdd10ddad6cce81ee2b074d5c8c4e84d266878a4333f30" },
      { len: 7, hash: "cd0e0f87c84f4dce7f14a410ee92d68e443cd4b3d6217c75163e7a3e45b5a965" },
      { len: 7, hash: "11af0c0d1f5f22f87d76334edf78ea65b7d4afe508df1a7174852c758f18428a" },
      { len: 7, hash: "355aeb783456399c0af530783f943aadf69be50c660b7e0e225945db13435216" },
    ],
  },
  {
    id: "cs4-monsters",
    name: "Cursed Scroll 4 Monsters",
    type: "Actor",
    coversType: "Actor",   // any locked CS4 monster (src CS4) unlocks the set
    source: "CS4",
    pages: "55-66",
    file: `modules/${MODULE_ID}/data/locked/cs4-monsters.json`,
    anchors: [
      { len: 6, hash: "61571c81871a28a228884bf4d19dabe540001d581c67261b26aa721dc0903714" },
      { len: 5, hash: "68d41c325e3eedab17d731a277226b61b9b6af4f02b992e0f6c61bea12f786a2" },
      { len: 3, hash: "9aab0ff6eb1f4eb3ca980d1137af12de9c88fb330236840bac723b02d039a0b3" },
      { len: 4, hash: "d3fc9f46d0000276c6a47d493638021716836101c1bc1287b4114f35092106a5" },
      { len: 6, hash: "37e543421290c6f4b862f2f4f370ee92bbf72981a6f9cc5dc2cf5ca3289dfe27" },
    ],
  },
  {
    id: "cs5-spells",
    name: "Cursed Scroll 5 Spells",
    type: "Spell",
    coversType: "Spell",
    source: "CS5",
    pages: "12-15",
    file: `modules/${MODULE_ID}/data/locked/cs5-spells.json`,
    anchors: [
      { len: 6, hash: "cadf810517d04c663b0ab2c5eea748a2221e8ed4254db7f9d8b207f12af97250" },
      { len: 7, hash: "a573dd514cdb6d16fc75909279965c86b4773108225a0137011b4b48fcaab39e" },
      { len: 6, hash: "ca75a0d27939d349a2d1eaac130710320af098d7045a8deb0b6847bb20c35b70" },
      { len: 7, hash: "94960812a8c800085094ea9fce697e3b3c5011ddf9efe1a18241751e3a225b02" },
      { len: 7, hash: "495951998cda41ad4057f8e8c562cb23da2d8ceada27086813dcd1e5ed3e17af" },
    ],
  },
  {
    id: "cs5-gear",
    name: "Cursed Scroll 5 Gear",
    type: "Basic",
    coversType: "Basic",
    source: "CS5",
    pages: "16-17",
    file: `modules/${MODULE_ID}/data/locked/cs5-gear.json`,
    anchors: [
      { len: 7, hash: "78c5520e4523d68951b49cbfc4f156a3e6d714e7cca1f25e27c4b1b95674ce92" },
      { len: 6, hash: "a0b74885d8fa41530e41516b7d3d5c82014b748e4fd56ecf4b2d8af50a5d428a" },
      { len: 6, hash: "c9359b2d2085a2962d76545ae43453cb063544f9e14fbf851b3b07045a342de7" },
      { len: 3, hash: "9fd57b5f18ffd1b7217edda5e9a40a7e15b81807f193f4c6c6af8b0245f9c6e1" },
      { len: 7, hash: "12ae6da53be838d8a6882f49ae0431580551ec7f3d715853fce798448e10b6ae" },
    ],
  },
  {
    id: "cs5-monsters",
    name: "Cursed Scroll 5 Monsters",
    type: "Actor",
    coversType: "Actor",
    source: "CS5",
    pages: "18-24",
    file: `modules/${MODULE_ID}/data/locked/cs5-monsters.json`,
    anchors: [
      { len: 4, hash: "9f08fda630ff1385129b1dbe4902d42929ceab2c6cec8623c90be95deca9e94c" },
      { len: 5, hash: "8a6eec83b17a14216c7dd15c6f264ba5c55d3907b31ea1233949e12f8c5aa39d" },
      { len: 6, hash: "cf4b62b525248bf3df48c275039cf8568b125656b986b41889fcd08c8b811aa6" },
      { len: 6, hash: "1fb2e8d89600f3053f5d62a6dd7647a7fbc0e8771158259244706fc51addd423" },
      { len: 5, hash: "e658ac152b6b3230292b01a14c71d35ee292f92fb44777ec608e4738f15be8ad" },
    ],
  },
  {
    id: "cs6-spells",
    name: "Cursed Scroll 6 Spells",
    type: "Spell",
    coversType: "Spell",
    source: "CS6",
    pages: "18-21",
    file: `modules/${MODULE_ID}/data/locked/cs6-spells.json`,
    anchors: [
      { len: 6, hash: "c5ce5805a2b1e75fecc3d772e9101a8f26f1b19e8593cffb6a6e4daaf161390b" },
      { len: 6, hash: "3bf4033b5d5633b7e8769193ed5ecb9627e0d58a5e9254a51f55ad2a5c3aa96d" },
      { len: 6, hash: "256201341cea73775b701e72b46f8c7f1ac6d3d5370fc8bdcc958997cbccf609" },
      { len: 6, hash: "825ac2ed2ed67432044d7495961723febc6f4f7b9402e8cbd44445343fdb3811" },
      { len: 6, hash: "6468bf9972689dfe80a34c0ac749b272600a5a7fd800ff9fe221b0f3d448f2f9" },
    ],
  },
  {
    id: "cs6-tables",
    name: "Cursed Scroll 6 Tables",
    type: "Table",
    coversType: "Table",   // any locked CS6 Table (src CS6) unlocks the whole set
    source: "CS6",
    pages: "28-34",
    file: `modules/${MODULE_ID}/data/locked/cs6-tables.json`,
    anchors: [
      { len: 8, hash: "4bb541e84dbf89ca2139b75d1734e4b8e5d210bf7b85baa41b5e7cd9a81032fc" },
      { len: 8, hash: "72f3cccb7bcdc7f28589d5224132f218fd4636b37e3ddd50d3f9ca1fce7a405b" },
      { len: 7, hash: "b39d4bcbe5edffa33e1a20540c692a797616d6a727793ae34106429e31d9f8aa" },
      { len: 6, hash: "731fae349b908b2b6e978336625c9f5478be407442506a8c78d661a9e93c5856" },
      { len: 8, hash: "76a8e11551874d968d0d339cc9ac5a84ce421489c9b2e12e2856502a3f1636a9" },
    ],
  },
  // ── Cursed Scroll 1 (Diablerie!) — Diabolical tables + bestiary. ─────────
  {
    id: "cs1-mishaps",
    name: "Cursed Scroll 1 Mishaps",
    type: "Table",
    coversType: "Table",   // both Diabolical Mishap tables (Tier 1-3 + 4-5)
    source: "CS1",
    pages: "22-23",
    file: `modules/${MODULE_ID}/data/locked/cs1-mishaps.json`,
    anchors: [
      { len: 9, hash: "e0ad5277338b50b0464712434403b449e03f40ceee6e2caaefba5d2767fe5e9f" },
      { len: 8, hash: "585d17767e14a4708688637aad5f3ff294983c075432d57fc1226081add07641" },
      { len: 11, hash: "0fae6e8afaf75b34b056adc05e56f2283c6c85d9e37a4054802dc3d3d7258f3d" },
      { len: 8, hash: "2bd4b5fdf7c02f27ba0fc7b4e6f7647e74cb7b48cb7e3a02e0ade359d1c6c4a1" },
      { len: 14, hash: "a27e6a01f93a9a0ccefa2bf1016cd294b806ed50346cf1f22fcc00932f08fa06" },
    ],
  },
  {
    id: "cs1-treasure",
    name: "Cursed Scroll 1 Diabolical Treasure",
    type: "Table",
    coversType: "Table",   // back-cover d20 Diabolical Treasure table
    source: "CS1",
    pages: "68",
    file: `modules/${MODULE_ID}/data/locked/cs1-treasure.json`,
    anchors: [
      { len: 10, hash: "336cc2065f5dc8d3ba71e81fb2d6ea201f2503d84f0f5a49fa3651cae37902ea" },
      { len: 8, hash: "d486ba8df625c83f546c9fcddc4a25fbba2a7996d10978b4ef9d65686568ca03" },
      { len: 11, hash: "b8da34690f4e93193cd2792d70e7063a6cb4528e9be7cff963cc0efbf6551683" },
      { len: 11, hash: "fef3162869dea30ed5fafa5188b2ed79c2d5e17ddebc9a5803df724780b0670c" },
      { len: 10, hash: "35d6b1ee853b9b15e686a46488976bc2975f10c38b933ccd56ccf98d1cfac34a" },
    ],
  },
  {
    id: "cs1-monsters",
    name: "Cursed Scroll 1 Monsters",
    type: "Actor",
    coversType: "Actor",   // any locked CS1 monster (src CS1) unlocks the set
    source: "CS1",
    pages: "45-48",
    file: `modules/${MODULE_ID}/data/locked/cs1-monsters.json`,
    anchors: [
      { len: 12, hash: "aee136c67a9f63bc45c32bc7a33b9a857eb1f2bbc3070aeb23652d7a20fe95ab" },
      { len: 14, hash: "165ac7a1da0f81343131dfd2b282c54f9af60a5d3df297bbbd7ee49c38b923d0" },
      { len: 11, hash: "b529c57ff979e36c958ffaa1deedad31f987fa1277fed06b3e9f01f342ab82db" },
      { len: 9, hash: "8323b391c4a6df5db19137e071a60cde69093b462be0e1fee7cb419187773070" },
      { len: 10, hash: "c79ace0bbf054b90824167f14893ad53d52d9fc414aa8cf0a23b8d7a1cdfb5c5" },
    ],
  },
  // ── Cursed Scroll 2 (Red Sands) — tables + bestiary. ─────────────────────
  {
    id: "cs2-enduring-wounds",
    name: "Cursed Scroll 2 Enduring Wounds",
    type: "Table",
    coversType: "Table",
    source: "CS2",
    pages: "26",
    file: `modules/${MODULE_ID}/data/locked/cs2-enduring-wounds.json`,
    anchors: [
      { len: 11, hash: "5d38e6221a51ce746a43b45e310a03498367c40859bb281ff7828a1bad643e51" },
      { len: 9, hash: "c63cf6e5bda12f0ccdd6618b8b9ebfe27150afd47ea1d7b8c513201dc80f8834" },
      { len: 10, hash: "3a95415766725300c1555da2628f2043fac82f06165e22ee5738309d2bdad45f" },
      { len: 9, hash: "5d4d0eb52cf9244c7330b2595f5adba93fd433ec149aabc71ddd0e0a39718914" },
      { len: 8, hash: "a72f172d2ff9586d60bd65b7e73b92a58fb294570cb9d742ed2193bf05899b9d" },
    ],
  },
  {
    id: "cs2-dead-bandit",
    name: "Cursed Scroll 2 Dead Bandit's Hand",
    type: "Table",
    coversType: "Table",
    source: "CS2",
    pages: "68",
    file: `modules/${MODULE_ID}/data/locked/cs2-dead-bandit.json`,
    anchors: [
      { len: 10, hash: "d134b34c8f4f154c42f76bef97583d94cea43c554de210e89162ad3f1bc6fdc2" },
      { len: 9, hash: "cb8003b09712cc6ea96ec99275da39bdac43535290350cf243cf46a0d0ac2441" },
      { len: 7, hash: "5a9f7d4788c77dbf07c3233e21370ef1ad660fbc621d17c244d7455bad53533c" },
      { len: 10, hash: "cfa3438f5f08645c0906c794372dc90d33376b5cc9ed202d32eeaf5b75d5d5d7" },
      { len: 12, hash: "cf7b6338d3f831f07a443d1ef2ea59802d3f3dd6c013d45a57db01d64549f376" },
    ],
  },
  {
    id: "cs2-monsters",
    name: "Cursed Scroll 2 Monsters",
    type: "Actor",
    coversType: "Actor",   // any locked CS2 monster (src CS2) unlocks the set
    source: "CS2",
    pages: "39-43",
    file: `modules/${MODULE_ID}/data/locked/cs2-monsters.json`,
    anchors: [
      { len: 9, hash: "322d0db37fb833e3575a4a64ccf955289dd0f9141209af57115d23d8fd7817be" },
      { len: 14, hash: "c83e1fe15640fdd34f8e24282da40df75675148357d92a512f28741b77cf39bf" },
      { len: 10, hash: "abb281ae14950b7f17831da60f2a8b31ed6d6a0674abb2a9648848dcd2d99684" },
      { len: 13, hash: "7ff2569050da0acc9af19bf4396a2fb439302c52bf0494520f05e2447db31fde" },
      { len: 8, hash: "da7853310a719d61e006bf17b79e557b23099b6c0ea312b46d0bafecd6d4a6d0" },
    ],
  },
  // ── Cursed Scroll 3 (Midnight Sun) — tables + bestiary. ──────────────────
  {
    id: "cs3-nord-names",
    name: "Cursed Scroll 3 Nord Names",
    type: "Table",
    coversType: "Table",   // 4d20 compound (parent + Male/Female/Surname/Title)
    source: "CS3",
    pages: "16",
    file: `modules/${MODULE_ID}/data/locked/cs3-nord-names.json`,
    anchors: [
      { len: 5, hash: "e09947be38e784b79b9d28dd62e6ef9b2ae0bb42739496a7654a38b0e4d67c2f" },
      { len: 5, hash: "e367c7dc3f104e3b7467bcec94bbc15972f3e7834fa52326994165de75e8572b" },
      { len: 5, hash: "b09458a1b08d93772007faffe586f9a101ba544b4e3b0b47a82e498c7477fa0b" },
      { len: 5, hash: "273753b801037d2678f8a0033f0f3dfcecee1d86ad1d74df18397233d0854a5a" },
      { len: 5, hash: "c2d4bba962e12a18b8e4a7add362ecda75b67fbaa24cb0e58a203a4aeb0cf1b3" },
    ],
  },
  {
    id: "cs3-arctic-encounters",
    name: "Cursed Scroll 3 Arctic Sea Encounters",
    type: "Table",
    coversType: "Table",
    source: "CS3",
    pages: "26",
    file: `modules/${MODULE_ID}/data/locked/cs3-arctic-encounters.json`,
    anchors: [
      { len: 13, hash: "40c8a04d72610e4624aa1888781924ed0031a798fdc8f89c311eb2c0b7069b93" },
      { len: 10, hash: "e202f156c4a74e576b279a8109f3016e16cb015e24e6c256d3ba2a31b78a5828" },
      { len: 10, hash: "333e9d34ad2380ace2ccc132c262e37b69c72eb360d4a7abb63d77517431780b" },
      { len: 9, hash: "6447013ffe3df7a0e923d2f233d9036d14b54958bcec145dea23c0b5b3c2e560" },
      { len: 9, hash: "749117fe6822884485e64dadcd34a5e8efcf9191fd3b85c519dc67e7fa886b20" },
    ],
  },
  {
    id: "cs3-sea-wolf-plunder",
    name: "Cursed Scroll 3 Sea Wolf Plunder",
    type: "Table",
    coversType: "Table",
    source: "CS3",
    pages: "68",
    file: `modules/${MODULE_ID}/data/locked/cs3-sea-wolf-plunder.json`,
    anchors: [
      { len: 12, hash: "d82ddce84410002f87b4dcd47aaf7adf9da8b8cc22fb98017a89f2f8fb2171e7" },
      { len: 9, hash: "02b7bc6b2a7805d80bc983988f3463254c1972f11116f8f9babe8427f48a8ea7" },
      { len: 9, hash: "0b57f48917423302fce99289bc22a228c3f66fea60e48c7a539f15da33f55fb6" },
      { len: 7, hash: "ccb833f43594490502df1cbb6d0f5b5a94b3abfb2d54367bbc5afb8e66c72970" },
      { len: 9, hash: "003fa688d04622de1e7df988c05513e8362c79b30a882725cb8395e7d2eef874" },
    ],
  },
  {
    id: "cs3-monsters",
    name: "Cursed Scroll 3 Monsters",
    type: "Actor",
    coversType: "Actor",   // any locked CS3 monster (src CS3) unlocks the set
    source: "CS3",
    pages: "43-47",
    file: `modules/${MODULE_ID}/data/locked/cs3-monsters.json`,
    anchors: [
      { len: 15, hash: "c92ec8f8576328aeba28eb1945583acf97227376066ec28afbce07f59117224c" },
      { len: 9, hash: "89a19da942e066662224623ff7708bd13cf11a92712fa91e34f8e1fe31dad9b4" },
      { len: 11, hash: "49e26e35ed1205f2261614f99f81b6bf04bef5cc2077670bbc60137732c53144" },
      { len: 10, hash: "ee59a3caa7cab9bb93ef736d220e8f53c184642e0d950588d7a363439207fe2b" },
      { len: 13, hash: "afa8062f9861e13d94060303dc601ec8de9ef36544ef1838fc161dda9291c447" },
    ],
  },
  // ── Core Rulebook — GM tables, encounters, treasure, boons, magic-item
  //    attributes. Grouped by section; unlock a group by pasting its anchor
  //    section (dashboard names the representative table). ─────────────────
  {
    id: "core-encounters",
    name: "Core Random Encounter Tables",
    type: "Table",
    coversType: "Table",
    source: "CORE",
    pages: "146-188",
    file: `modules/${MODULE_ID}/data/locked/core-encounters.json`,
    anchors: [
      { len: 10, hash: "993d4e5d1211641b29ef4a0a4676b154f10dfa3194e8acc8273f2ea8e725e5f0" },
      { len: 11, hash: "6f85ba9eb82b132b0757acb7709c1aa2ca2107031a6c6a914a8a999f28e0ac1f" },
      { len: 10, hash: "77ad6539c39ed105e6ac649ed523894f1b2d110923cba00074194e0943e29452" },
      { len: 13, hash: "bc9a28449f80e12dd21f6cee526168b57fbe6e2eb69413b2865824f217790ffb" },
      { len: 10, hash: "aa2b44512311bf5a3a3f41e609556db0793cda305df017695db5961ea464f5df" },
    ],
  },
  {
    id: "core-treasure",
    name: "Core Treasure Tables",
    type: "Table",
    coversType: "Table",
    source: "CORE",
    pages: "274-283",
    file: `modules/${MODULE_ID}/data/locked/core-treasure.json`,
    anchors: [
      { len: 7, hash: "fa0f1910b1b04594b7cfe62556f9844bedf7c1b530497760b22f63efbfaff568" },
      { len: 8, hash: "74b6b1dc077104fcd875f2235d1e9a23f9b7242db60cc948437173c418177d3a" },
      { len: 7, hash: "16ca25e35f949f6a87167367c6a01aaf713b8045070cba855603ee66cab9d0ef" },
      { len: 10, hash: "45cf7c03a5ef941ee6d9df9e12565d6520b7940a8fdfce7ec6a1e54c331ac2be" },
      { len: 7, hash: "0005502b13f9e515d58c10db95c08d0c1a82a4153d47965e85e7862dfcc9ad9e" },
    ],
  },
  {
    id: "core-carousing",
    name: "Core Carousing Tables",
    type: "Table",
    coversType: "Table",
    source: "CORE",
    pages: "96-99",
    file: `modules/${MODULE_ID}/data/locked/core-carousing.json`,
    anchors: [
      { len: 16, hash: "576a883139dd4fe078f3d3ec879e84d350568b3a7fd15e269778a9c1538ac5fa" },
      { len: 11, hash: "7779855f315ef1077b35d760bdd17507d227348d94ed4369631038be69b6dae7" },
      { len: 14, hash: "e7430998626d57cbde16a61bfa9d41cdee32fdf2873e2209ba5d8ce5c7a615a1" },
      { len: 10, hash: "f2e937b9420626ca58a9cac29fe98d45fc61d834ea23a27ca167a52dff108b3a" },
      { len: 13, hash: "7c4ce1d4dbb903ac334373e9f8a3f6c81c7dcfcf1435c59d6860b9b1aa32b32e" },
    ],
  },
  {
    id: "core-traps-hazards",
    name: "Core Traps & Hazards",
    type: "Table",
    coversType: "Table",
    source: "CORE",
    pages: "118-119",
    file: `modules/${MODULE_ID}/data/locked/core-traps-hazards.json`,
    anchors: [
      { len: 7, hash: "9456aa6d44332dd6b8b7a5b7a5ba615e6884fe8d4fba815b7ef49ee9114c8426" },
      { len: 7, hash: "0a18adc3b6a782ef9097615c1989df273a58bf2ef765c4175d2780e840dc0eb1" },
      { len: 8, hash: "d19fbb616ead39ed8c725749d0aca77dfb36002305f1aa8c7ea5a4618fff2891" },
      { len: 6, hash: "c146d0f12a7ebce746cb2fe89bfc9d66060ee66e74eefe0ce9dc5add732d9930" },
      { len: 9, hash: "dd194a7931d898f2ba792e078358c47f7bc69b4c37e78972ce5867885966fa3a" },
    ],
  },
  {
    id: "core-something-happens",
    name: "Core Something Happens!",
    type: "Table",
    coversType: "Table",
    source: "CORE",
    pages: "122",
    file: `modules/${MODULE_ID}/data/locked/core-something-happens.json`,
    anchors: [
      { len: 12, hash: "52d3c54102afb5706d3acdf5dbe0db3c37206d13c236840a3290a3ce97cc26b1" },
      { len: 12, hash: "c174b7971ede92c4f61871ab33a661792d621387115a8d9b05fc39144dda6bf7" },
      { len: 11, hash: "60d0f09fb0d174b26d267f0d896f6e588ecddb57d4dede814053a7578efbe954" },
      { len: 8, hash: "114bbaf35f6f13c58eacb02152deacb91550f8161b513ad5adc990eb03db616d" },
      { len: 11, hash: "c214257b348ada0996b9971a81d2e58c01dbc72065ceb2005919d8597a52a108" },
    ],
  },
  {
    id: "core-rumors",
    name: "Core Rumors",
    type: "Table",
    coversType: "Table",
    source: "CORE",
    pages: "124",
    file: `modules/${MODULE_ID}/data/locked/core-rumors.json`,
    anchors: [
      { len: 11, hash: "14bb314b906717f0f4881a95ec05295e9a87f28c1828311ee006773f3418eb2f" },
      { len: 11, hash: "ab0856d3721cdb455e50c7e24e9c1db9115572423600c7cee653d72effa137e6" },
      { len: 12, hash: "15afd1cc0641ed3d6b87facd8b1fe39c492cde8d2941135c122c4a8eebb538f7" },
      { len: 10, hash: "fda0cf0387225e56639af434a5c5960d98148164264b5565473cd0c0a3ebb38d" },
      { len: 10, hash: "bcc4775807b23ad54b291fcf4e2d4a2ff22c212d5ecb31758fac8aae5262c53f" },
    ],
  },
  {
    id: "core-adventure-generator",
    name: "Core Adventure Generator",
    type: "Table",
    coversType: "Table",
    source: "CORE",
    pages: "122-126",
    file: `modules/${MODULE_ID}/data/locked/core-adventure-generator.json`,
    anchors: [
      { len: 7, hash: "0eb136ca597f993d39cb63eae13a67a8250071f1f8ff738f5a707a8c1564544b" },
      { len: 9, hash: "f605869caa2249d58e64f423c326f6e03814cd119163373fa50241aeaffc6320" },
      { len: 7, hash: "c89e634106175c6ef13deccb3ec18c2a7065c3615604b7fae5ec5fd4fad303e0" },
      { len: 7, hash: "3b54398b56e53d6e2cf951ea5c0ad994aec2e78883eaa64bf9581124bf950cc0" },
      { len: 9, hash: "05efed63739125fa81ed1c5cc34f348d2f3caaf8ed52dabe77e3d6aa172e02f9" },
    ],
  },
  {
    id: "core-tavern",
    name: "Core Tavern, Food & Drinks",
    type: "Table",
    coversType: "Table",
    source: "CORE",
    pages: "136-140",
    file: `modules/${MODULE_ID}/data/locked/core-tavern.json`,
    anchors: [
      { len: 12, hash: "10b6e355127142f8c0ce0aec883a65280a06309e4f0f444177971f8a91081a1f" },
      { len: 12, hash: "11b5cbff2168f0505917a794720b2919141e4f46a9000449ce7e4737ec63d587" },
      { len: 12, hash: "f87d0a95bfb60a44ebcb8104b57801997f22b956da3bb4baad23a7649b1ef91a" },
      { len: 13, hash: "d91f86cc6603a638bd2f2bdd41a0ec1164cbf45f9bf6c359a2cfa7e81efebe49" },
      { len: 12, hash: "d8b96b7ba464da6553eef18c1cec988044e7decebf71686d272c6361b979ef4d" },
    ],
  },
  {
    id: "core-shop",
    name: "Core Shops",
    type: "Table",
    coversType: "Table",
    source: "CORE",
    pages: "138-143",
    file: `modules/${MODULE_ID}/data/locked/core-shop.json`,
    anchors: [
      { len: 5, hash: "ff03a9a73d11adb70934f288ee3581f48bf9ff4033a59df07a9eb185a4987bed" },
      { len: 6, hash: "35bff9e6a1fd17e41f303b36efcfc11c7e5371cbcb2acc00453531215218a241" },
      { len: 7, hash: "1143523b4bb1fccf59585c497c070424ccc607e3bcc0a71738861576de97169c" },
      { len: 8, hash: "74d7ab85c330c0d6040a1be1ccae592077bc527a4df63dfb8dfc6d336604dddd" },
      { len: 6, hash: "726675c99ef2900128c818c3f1cf1ca2e642d76b3d64b2ff32f0aad6811a95b3" },
    ],
  },
  {
    id: "core-boons",
    name: "Core Boons",
    type: "Table",
    coversType: "Table",
    source: "CORE",
    pages: "280-281",
    file: `modules/${MODULE_ID}/data/locked/core-boons.json`,
    anchors: [
      { len: 10, hash: "dc0aec8620dd9bf7834c9b158d82e50d0e589524abcee05680a9dd12481406f0" },
      { len: 9, hash: "e253f08c0e7bd00efd5c54c5a1d57ceb656245f8c66a4c3cfb460ac818232f23" },
      { len: 8, hash: "536b584c5cec5e3d4052477b66ef50c86f0a7255efadcb6b7b24a8e7438cde50" },
      { len: 14, hash: "dc964c11a506f3e7b9d20d159f25c5374f7284f2382415eab4230c25ff4c6c8e" },
      { len: 12, hash: "0c2076a7138cbb7334304a1ebf57d9fa68b1672d15622368384fafe5ce6741d7" },
    ],
  },
  {
    id: "core-magic-attributes",
    name: "Core Magic Item Attribute Tables",
    type: "Table",
    coversType: "Table",
    source: "CORE",
    pages: "282-295",
    file: `modules/${MODULE_ID}/data/locked/core-magic-attributes.json`,
    anchors: [
      { len: 8, hash: "db6e5b02aa345dbb6e8ba52c8773fc1545a5eef3c6579e9b54c2ce9c1add39cd" },
      { len: 8, hash: "3d168236784a914b99ca302624d9eebca0c3430bb90f72b11544d3b9318d442b" },
      { len: 6, hash: "77a6c6474c43a99c72d2049b53ca7da0a43f807a42249bf307f4bf4145b92764" },
      { len: 9, hash: "05415840ff66f566a471b8792977215d000865bd3fa44091c0c6c6011bc9640c" },
      { len: 8, hash: "f3b7554e29745fcd2ae01df16c8023a0dee8e14b3cda683c41c808096a20b871" },
    ],
  },
  {
    id: "wr-spells",
    name: "Western Reaches Necromancer Spells",
    type: "Spell",
    coversType: "Spell",
    source: "WR",
    pages: "52-58",
    file: `modules/${MODULE_ID}/data/locked/wr-spells.json`,
    anchors: [
      { len: 7, hash: "dbcc07878087f208bf0754a8338f3bc56a6041b7644d34a9e1cde809d8338a74" },
      { len: 7, hash: "edc3860170f216e4b0fee7140dbe22c2c2cf8f72e62a3928c882a93063480691" },
      { len: 7, hash: "170012c7ea14b4d515f352a090e72cd676d8fb42cbc2449f7619369cd3747616" },
      { len: 7, hash: "68bd090eed14d968b9bfd30981babce559241b2723460cc7c85a8c362323fca1" },
      { len: 7, hash: "dc3772f55586cab911b5e70fd1bbbb34aaefbd20b4167e0cf51e5930ee3194a1" },
    ],
  },
  {
    id: "wr-priest-spells",
    name: "Western Reaches Priest Spells",
    type: "Spell",
    coversType: "Spell",
    source: "WR",
    pages: "132-140",
    file: `modules/${MODULE_ID}/data/locked/wr-priest-spells.json`,
    anchors: [
      { len: 5, hash: "b78ccb2078ef2e72d7bbb8f557ddf8fb34985b53266ba6a5807e53cd32c6f2b9" },
      { len: 7, hash: "56fb62d90338e4cdbceb026b7062aa7103a143d5463aa59e44d74df10fca326b" },
      { len: 7, hash: "f957233016fd6a5d72132c58a7a464aed604fc300b2b6ec0efd9e868b64e6410" },
      { len: 10, hash: "74a68e17caa4fc18f2c71c9d0a9a8f2868513483acab832b14fa9ef764ad2185" },
      { len: 10, hash: "1c1e9d89337c5a9c76044b2e4dc30d1cfcec12f7bdfa69c6fbc4f56ec3bfa89b" },
    ],
  },
  {
    id: "wr-gear",
    name: "Western Reaches Gear",
    type: "Basic",
    coversType: ["Basic", "Weapon", "Armor"],   // Mithral shields, boats, siege, WR weapons
    source: "WR",
    pages: "116-120",
    file: `modules/${MODULE_ID}/data/locked/wr-gear.json`,
    anchors: [
      { len: 10, hash: "1880d69d4422e47c82a04f99c1d195f16f8687a5871e9ed4f9e0ea5d45f1d75d" },
      { len: 10, hash: "63bd70815707757e6110d49a26dfc10528216a050700b1623ea6202669a679d4" },
      { len: 8, hash: "cffb4613b2276782dffcce8e2fa0cb1a2195572fbb178398d0d0259d17b1639c" },
      { len: 9, hash: "e96d6bdb5caa912a30f16c99bbe2a67630d5b10ea0e07ea39f36aa8e20a15344" },
      { len: 7, hash: "09e87f6038fe2622f81fefdf6ad9b90d6567282284e97016a0de061a6f36aab0" },
    ],
  },
  {
    id: "wr-half-elf",
    name: "Half-Elf",
    type: "Ancestry",
    coversType: "Ancestry",
    source: "WR",
    pages: "24",
    file: `modules/${MODULE_ID}/data/locked/wr-half-elf.json`,
    anchors: [
      { len: 8, hash: "bf87b6456f86a259ce200bab8c437cf26297a267017a35a2721526aa67159e54" },
      { len: 6, hash: "8a2e059daca2c17acc7de2467682fbb8fd92427041d5a03677f28025d55fe3fa" },
      { len: 11, hash: "4e54ccb0d7209852787d6c11e4c2f9c844c34a44bda1e288303ceee34a2a3782" },
      { len: 12, hash: "08dded9da8514ecea2054a9159a0f44d15912be7cb7d1dded6b578d2e6951d03" },
      { len: 8, hash: "0f0e4c82404ea137386d787cb9091629cb344529c9ee2067525ea494010dba6d" },
    ],
  },
  {
    id: "wr-ancestry-tables", name: "Western Reaches Ancestry Tables", type: "Table", coversType: "Table", source: "WR", pages: "20-31",
    file: `modules/${MODULE_ID}/data/locked/wr-ancestry-tables.json`,
    anchors: [
      { len: 3, hash: "446c10e6ac465dc3211f6f982d0521fe017124b38ec6f237fce418e0fc641055" },
      { len: 3, hash: "4e6f13b7bcdf9a1ade70a12343f38a58e209986a6c8d07726731a3b07c3a7877" },
      { len: 4, hash: "46be81ab31edb6cecfca851cfbf896d9f60c928b13a3c40149ff897c80030dea" },
      { len: 3, hash: "90cd247ea5d17f6f5746a29e77ad4704acc1efbbf34c6cb57dc044796c781c84" },
      { len: 4, hash: "abd08c1840a3d787d2859b8aff60a504d5a5bd6c97ae47f956b46729ca36b04d" },
    ],
  },
  {
    id: "wr-anc-dwarf", name: "Western Reaches Dwarf Name/Trinket", type: "Table", coversType: "Table", source: "WR", pages: "20",
    file: `modules/${MODULE_ID}/data/locked/wr-anc-dwarf.json`,
    anchors: [
      { len: 3, hash: "446c10e6ac465dc3211f6f982d0521fe017124b38ec6f237fce418e0fc641055" },
      { len: 3, hash: "d6ac06091919f0398c5e5ee078ad15d7575efcdc27cbce2af747e2551643c766" },
      { len: 2, hash: "9c4091232302ebaf34515834e7aa01d9d09e1767e5e88b6eb42f729921b0f668" },
      { len: 3, hash: "c7aa8c23f40bcd425cad44b8ff490a649fbfbcb2d04d70264d2240ced41530ae" },
    ],
  },
  {
    id: "wr-anc-elf", name: "Western Reaches Elf Name/Trinket", type: "Table", coversType: "Table", source: "WR", pages: "22",
    file: `modules/${MODULE_ID}/data/locked/wr-anc-elf.json`,
    anchors: [
      { len: 3, hash: "4e6f13b7bcdf9a1ade70a12343f38a58e209986a6c8d07726731a3b07c3a7877" },
      { len: 3, hash: "0d10a9c48f37a79d92cac0bf90913a7e050ba5f1108d04ea1575dc301501df21" },
      { len: 3, hash: "e9ea4b1fcd5ed29710fe74bf9202abdfd2d3e8dbc07d95adee46517c260df6d2" },
      { len: 3, hash: "a5a55e3136c64eb27820e346087c8987a510f8bae5bd494a0787e86078ab6159" },
    ],
  },
  {
    id: "wr-anc-goblin", name: "Western Reaches Goblin Name/Trinket", type: "Table", coversType: "Table", source: "WR", pages: "24",
    file: `modules/${MODULE_ID}/data/locked/wr-anc-goblin.json`,
    anchors: [
      { len: 4, hash: "46be81ab31edb6cecfca851cfbf896d9f60c928b13a3c40149ff897c80030dea" },
      { len: 3, hash: "1abd5750452b8dbf47bfeee37c73dd71d22be0d28a3f9ab4f408ea8aa6c7f269" },
      { len: 4, hash: "1bfa96a9da40a471600a4e12e4b590acc3517a828cd675eaec61490776c20853" },
      { len: 4, hash: "60578660c82f6c468044c287020e29e83155e5c9e936aa6f9846f5d6b7d7a84d" },
    ],
  },
  {
    id: "wr-anc-half-elf", name: "Western Reaches Half-Elf Name/Trinket", type: "Table", coversType: "Table", source: "WR", pages: "25",
    file: `modules/${MODULE_ID}/data/locked/wr-anc-half-elf.json`,
    anchors: [
      { len: 3, hash: "90cd247ea5d17f6f5746a29e77ad4704acc1efbbf34c6cb57dc044796c781c84" },
      { len: 3, hash: "d8c727cbe229e565bfa411acafa0276402a587d86eb6594cf0495f213accec71" },
      { len: 3, hash: "00a8ea7c2c24763435a5e9e8f39f503baf22b2d0a6910e9fdf7c9a7fd9267f68" },
      { len: 4, hash: "ec5b7b5f7fb50dcaa7c70066b7a2e9258b178d24d23e9a4ba960530af8510392" },
    ],
  },
  {
    id: "wr-anc-half-orc", name: "Western Reaches Half-Orc Name/Trinket", type: "Table", coversType: "Table", source: "WR", pages: "26",
    file: `modules/${MODULE_ID}/data/locked/wr-anc-half-orc.json`,
    anchors: [
      { len: 3, hash: "b2d908bd1975267fd73b128ef736618a27abab959b074034727ee7051e11b70a" },
      { len: 3, hash: "8b09c949370d10e7f1990e8736fe275e32aaa835fb0bbb65fe1f3ad7a3592c95" },
      { len: 3, hash: "f6b748a333a71303cfd01d08fbc683af191b8e05064d1d75f0eb0f002e8eac8e" },
      { len: 5, hash: "4e1cc4e6e404d7a6b08ea14ce88fa8843f37e4fe6be166778398129aeb7f7e30" },
    ],
  },
  {
    id: "wr-anc-halfling", name: "Western Reaches Halfling Name/Trinket", type: "Table", coversType: "Table", source: "WR", pages: "28",
    file: `modules/${MODULE_ID}/data/locked/wr-anc-halfling.json`,
    anchors: [
      { len: 4, hash: "abd08c1840a3d787d2859b8aff60a504d5a5bd6c97ae47f956b46729ca36b04d" },
      { len: 4, hash: "3b48d3b3a50eb3023f58df9f402f7e09d8668537ebabadc8c7b7ba79f3fb2331" },
      { len: 3, hash: "98a790dacf98110dbe7ed7799c801ec5a0dd48af7552fd3e005319cc3c4ffa26" },
      { len: 5, hash: "36bd46b15c971eb46c572ad6f5040cfee3c70087b3c4d31585090e00bcaa3778" },
    ],
  },
  {
    id: "wr-anc-human", name: "Western Reaches Human Name/Trinket", type: "Table", coversType: "Table", source: "WR", pages: "30",
    file: `modules/${MODULE_ID}/data/locked/wr-anc-human.json`,
    anchors: [
      { len: 4, hash: "be0bafdc1f5156d7e72c6aa7966f5d9973477189e178cf962c575e4b83e21c28" },
      { len: 4, hash: "b2375a711de4865b32d6dfec36ccfaa39a4c586645a53c2a52881bef83d706db" },
      { len: 4, hash: "84ea09366bbf59a3abbdcecb549f3d8b1b4383082fba646b094bea0a8ae6d95c" },
      { len: 4, hash: "cd86e7f8753285480a0af48f2045eff5e631af6ce9ced42490220896b45a75f1" },
    ],
  },
  {
    id: "wr-anc-kobold", name: "Western Reaches Kobold Name/Trinket", type: "Table", coversType: "Table", source: "WR", pages: "31",
    file: `modules/${MODULE_ID}/data/locked/wr-anc-kobold.json`,
    anchors: [
      { len: 3, hash: "1fa3f67e71f83edafedc852e8d7d0250a5232d950ed95df91d141cde7f588ac2" },
      { len: 3, hash: "ee4c94f035dafa53b9c86d0825db192ce735bfbf59560aa6661f55711a3739a9" },
      { len: 4, hash: "65ca05fd983d86dab77babe813090b8fecca0d4f8ec31f67a3643c0c60777f00" },
      { len: 3, hash: "965336ff6bfc253e9078b617e7304c6241d141038d8c6887918d1955012792dc" },
    ],
  },
  {
    id: "wr-anc-dwarf-names", name: "Western Reaches Dwarf Names", type: "Table", coversType: "Table", source: "WR", pages: "20",
    file: `modules/${MODULE_ID}/data/locked/wr-anc-dwarf-names.json`,
    anchors: [
      { len: 6, hash: "83d311408c101574ab168405d86bb4953b3ddc143f8d709f675597999738d69e" },
      { len: 6, hash: "3a8cd7554e1ed69fe08a43c4ae2dfac05fc2248218964a1b8c7a42786b49873d" },
      { len: 6, hash: "95b413bbbb3e86cabc8966ab80e80d48b6a032322af2a19cace6cebf2ce9dd13" },
      { len: 6, hash: "fc6f128faa246b75487e0925ba3a2c90e48f5a6a37dea67674767d00daa5be26" },
    ],
  },
  {
    id: "wr-anc-elf-names", name: "Western Reaches Elf Names", type: "Table", coversType: "Table", source: "WR", pages: "22",
    file: `modules/${MODULE_ID}/data/locked/wr-anc-elf-names.json`,
    anchors: [
      { len: 6, hash: "043f5749aa722a2aecb2562215b0bbc7483a4627e353a2da115f30c60c4bf0ca" },
      { len: 6, hash: "923f81755a1d899bf93d3fc881579905757d2422928a15496901ee5bc6de3696" },
      { len: 6, hash: "28dcd1d08133712494f02d2997fb3d612e19ade278c50f753e23eec62e80d3d3" },
      { len: 6, hash: "651da5ee62a9e2463c285f9cc74f2ff284ceb4cb0cf97636b30077d8b4547abb" },
    ],
  },
  {
    id: "wr-anc-goblin-names", name: "Western Reaches Goblin Names", type: "Table", coversType: "Table", source: "WR", pages: "24",
    file: `modules/${MODULE_ID}/data/locked/wr-anc-goblin-names.json`,
    anchors: [
      { len: 6, hash: "71f14d394086a4b392d5bb1bb15ad40176e32d1aee4a60a3763499b10b27b971" },
      { len: 6, hash: "46c9b3afd5c8586caa76b505d9dded88f2b3f336759265d849b68df45d057993" },
      { len: 6, hash: "0d3b372a4ab582d464ad537939938bb73ec5bfd0e2abac87871b666369fa75b8" },
      { len: 6, hash: "3803e28fdc115e18c492066e3f54eed1e9530e972956bd46e87b3ffda9e9b6d2" },
    ],
  },
  {
    id: "wr-anc-half-elf-names", name: "Western Reaches Half-Elf Names", type: "Table", coversType: "Table", source: "WR", pages: "25",
    file: `modules/${MODULE_ID}/data/locked/wr-anc-half-elf-names.json`,
    anchors: [
      { len: 6, hash: "d13124efe2c3f2752a7e90dbeac7238dcaf1ed08ed7022d3742c8621d1427e24" },
      { len: 6, hash: "d35ce1cc6775888ef645c569f13030a8998f66532892557163aade76494418af" },
      { len: 6, hash: "539818566828dbd6c924b5e761f7296d4e923178a8a84763f288e26db4b360c5" },
      { len: 6, hash: "d4fcc0599dc8c163806682abe2b1bdc503426d73d7e609af4fd9d0a97db29b98" },
    ],
  },
  {
    id: "wr-anc-half-orc-names", name: "Western Reaches Half-Orc Names", type: "Table", coversType: "Table", source: "WR", pages: "26",
    file: `modules/${MODULE_ID}/data/locked/wr-anc-half-orc-names.json`,
    anchors: [
      { len: 6, hash: "7f4b09f06bdd204bad1f3e26078f89689ff9f061c5ae98daedc01e0b605a67dd" },
      { len: 6, hash: "df3470ad36cb50246c9ac241c2988855f5f93012f07a87d9f07394cc70f90eb5" },
      { len: 6, hash: "5ad2aaa1232c9182bfb57c7fea0795647845dc0be21b08d003ffc85592b46018" },
      { len: 6, hash: "14f161636629e65a83515982db014140a00d845517810d8856deb0cb87d84a64" },
    ],
  },
  {
    id: "wr-anc-halfling-names", name: "Western Reaches Halfling Names", type: "Table", coversType: "Table", source: "WR", pages: "28",
    file: `modules/${MODULE_ID}/data/locked/wr-anc-halfling-names.json`,
    anchors: [
      { len: 6, hash: "eeb9976780c2785a2495908a097306725be9f0992ba5af6cc58c32cd6fd82b90" },
      { len: 6, hash: "581f13fa0695e5131264a5691e952eeee8d0aadc27cc957e4705c22a4b5705b4" },
      { len: 6, hash: "9a9181711601a9cf059889a63bbef1d47528c3136dc3cf78c7cd9e39fb57fd88" },
      { len: 6, hash: "9a6f943b51cfeffdf3395d41bf00a99bd4ddaf376b1405eb324c9ce2b41876d9" },
    ],
  },
  {
    id: "wr-anc-human-names", name: "Western Reaches Human Names", type: "Table", coversType: "Table", source: "WR", pages: "30",
    file: `modules/${MODULE_ID}/data/locked/wr-anc-human-names.json`,
    anchors: [
      { len: 6, hash: "7755ccea466792a6aed9da39dd3d766ad0f5de30445df0395c5828926da296c3" },
      { len: 6, hash: "80da0549d29794f0eed988b65124d1682cc4b38cfe4eff81b814f5300bf8c144" },
      { len: 6, hash: "dc1f9d71f58606ed0d43dd445ee2b2e15887dfc22c3dbc0280b2a50d601b4398" },
      { len: 6, hash: "087f6901ac0e53c8128edc42d7f0afc7241140b7f46e3e65d7e19d45c45408eb" },
    ],
  },
  {
    id: "wr-anc-kobold-names", name: "Western Reaches Kobold Names", type: "Table", coversType: "Table", source: "WR", pages: "31",
    file: `modules/${MODULE_ID}/data/locked/wr-anc-kobold-names.json`,
    anchors: [
      { len: 6, hash: "60786331d5ff72878da7bf0b62a2d50dca5b98966947a022aef80c959e0bcde4" },
      { len: 6, hash: "fc850932f1fec700210116b17e41e53cfcb127197fa700dd2e052a0a1c58f08d" },
      { len: 6, hash: "1758910340ca8234cf35e9cc97852b24451d592ee1b7e0df70208ff4c0a16f98" },
      { len: 6, hash: "d53b47e3e585b2a3965a08372b41ff69efb4b83620cf4e9830f46b17ae0e9fb5" },
    ],
  },
  {
    id: "wr-spell-mishaps",
    name: "Western Reaches Spell Mishaps & Warbands",
    type: "Table",
    coversType: "Table",
    source: "WR",
    pages: "184-186,248",
    file: `modules/${MODULE_ID}/data/locked/wr-spell-mishaps.json`,
    anchors: [
      { len: 4, hash: "56f52785bbf9353af5b2023e9ac0de121d7d8b027a52608e6f07f704d897bed9" },
      { len: 6, hash: "9db56ca6f14fb5e3cb869ee6e4c9c351aee7ba64a038503f49cb1314b5dc75b4" },
      { len: 8, hash: "bfefb3c6682839cbabf7641aea16f783fc0400fcd76d4e02df744769ef33cd60" },
      { len: 6, hash: "2f25f6824e5806d20f69a760dce5a4ca67a8943ecc4c2dbc1d1c43b5f3510e9e" },
      { len: 8, hash: "2bd4b5fdf7c02f27ba0fc7b4e6f7647e74cb7b48cb7e3a02e0ade359d1c6c4a1" },
    ],
  },
  // ── Dual-source: WR unlocks the CS spells; CS books unlock the shared classes.
  {
    id: "wr-cs-spells",
    name: "Western Reaches Wizard Spells (CS4-6)",
    type: "Spell", coversType: "Spell", source: "WR", pages: "124-148",
    file: `modules/${MODULE_ID}/data/locked/wr-cs-spells.json`,
    anchors: [
      { len: 7, hash: "6032dc8108c9729a98f8e32bd676b5d3da1998aa882421c6e341ba29d69e3017" },
      { len: 7, hash: "cd0e0f87c84f4dce7f14a410ee92d68e443cd4b3d6217c75163e7a3e45b5a965" },
      { len: 6, hash: "cadf810517d04c663b0ab2c5eea748a2221e8ed4254db7f9d8b207f12af97250" },
      { len: 7, hash: "94960812a8c800085094ea9fce697e3b3c5011ddf9efe1a18241751e3a225b02" },
      { len: 6, hash: "c5ce5805a2b1e75fecc3d772e9101a8f26f1b19e8593cffb6a6e4daaf161390b" },
    ],
  },
  {
    id: "cs5-delver", name: "Delver", type: "Class", coversType: "Class", source: "CS5", pages: "?",
    file: `modules/${MODULE_ID}/data/locked/cs5-delver.json`,
    anchors: [
      { len: 7, hash: "964b19e435d1da8d0187fddc66656f2a55696f644595948c12a19d72a5a9dde2" },
      { len: 7, hash: "cc0581f244e37341dd790e78203e38b9390d1b60996870cdf01f1b1ad1a7edc9" },
      { len: 7, hash: "71d73fd7a5251a9e1c9fa8a8ba939c62d8f89ff184f3c984cf1fc373b9a58b10" },
      { len: 7, hash: "f2dc72df551f283813c240ae3c77460f55ececdeeb98e29a60b453f5a90bc99c" },
    ],
  },
  {
    id: "cs5-wyrdling", name: "Wyrdling", type: "Class", coversType: "Class", source: "CS5", pages: "?",
    file: `modules/${MODULE_ID}/data/locked/cs5-wyrdling.json`,
    anchors: [
      { len: 7, hash: "0bdc888246de1f8c5de2db5b8570ab28164aa88434053038ce876a531e874855" },
      { len: 7, hash: "552657080fbe2ff80bd34069af99d939ba14bad77692d3b3aab6d180c0609777" },
      { len: 7, hash: "a931c8386b12b7bcaaf44e5d5c3f8efd61e00b9886d3ffa5c357b0b97685e46c" },
    ],
  },
  {
    id: "cs6-duelist", name: "Duelist", type: "Class", coversType: "Class", source: "CS6", pages: "?",
    file: `modules/${MODULE_ID}/data/locked/cs6-duelist.json`,
    anchors: [
      { len: 7, hash: "3948c9c949eaa8d1e0f863021bf02960ebe30a760d68636ded50f1abff7d3d39" },
      { len: 7, hash: "c4f02bc6bb316f1fa4bf49a02c50189e912583fe3d0e3db19b05f941396a249b" },
      { len: 7, hash: "c2846953de138584bd43c0837529f7c42f994d8d3ba98434db2744d497307fd9" },
    ],
  },
  // Carousing ships as twin units over the SAME 3-table payload (Outcome d25 +
  // Mishap/Benefit d100): one anchored to the Mishap table, one to the Benefit
  // table, so pasting either d100 page unlocks the whole set. The Outcome page
  // itself is numeric-only — no viable anchors (user-tested 2026-07-10).
  {
    id: "wr-carousing", name: "Western Reaches Carousing", type: "Table", coversType: "Table", source: "WR", pages: "242-246",
    file: `modules/${MODULE_ID}/data/locked/wr-carousing.json`,
    anchors: [
      { len: 10, hash: "a94301c91e7beef0b4aecee70e8c2a92c49431fab60f3c1cd9161111251ad4ab" },
      { len: 10, hash: "917d7c7e875fe0a80bb024f33f3b5a11372557e966136713ab447215a9c2683a" },
      { len: 12, hash: "ca20ef48fae967922905a6da366554abdb61770e65d5bc55df0bb2feb7738e6e" },
      { len: 12, hash: "daa76694fe16ce87213e06bf5b51d2aaab2ff1dff51390b68aa341aa8a9809a1" },
      { len: 10, hash: "5579d4f8e883845ea73e7a328eb52c53ef239536d705659aabc6cc377471ad3c" },
    ],
  },
  {
    id: "wr-carousing-benefit", name: "Western Reaches Carousing (Benefit)", type: "Table", coversType: "Table", source: "WR", pages: "238-241",
    file: `modules/${MODULE_ID}/data/locked/wr-carousing-benefit.json`,
    anchors: [
      { len: 11, hash: "523810e9655c36d0e7c31140b03f25035f82f0edeb1eb5418dab38aea78d3a93" },
      { len: 10, hash: "fe661c19428c98b62b7e8fb50c6ea05809688dffd78583fa326887f45ead70db" },
      { len: 11, hash: "3259acadf5c8093c66381120a55a256d7476b759d77f9267fb666e735f7ac789" },
      { len: 13, hash: "7f944c951cef85d46b8d2d9941eeba13a4fb56dfb0691cb118b17e1901650eaf" },
      { len: 10, hash: "10b0f3ea045725fd2a32a268dea19ec341505266f3ef1ce83873d7d6a46cba37" },
    ],
  },
  {
    id: "wr-backgrounds-table", name: "Western Reaches Backgrounds Table", type: "Table", coversType: "Table", source: "WR", pages: "74-91",
    file: `modules/${MODULE_ID}/data/locked/wr-backgrounds-table.json`,
    anchors: [
      { len: 10, hash: "f232a295cb82f417f8da7de2fd89d5b62870d63e64e445e7d358d97cf7c69925" },
      { len: 9, hash: "611f9e4fc023a3c3bf75be69081dfc10eafa79958a76fd3b374a8e442e809066" },
      { len: 9, hash: "bed9b46291261414ab3af39ccd533268dc4b50d48cada82b9472100ae39a5d08" },
      { len: 11, hash: "361962b1b7c2191ea3884f93212dcfbb3929bd782a5e87c697dda1274869ff41" },
      { len: 8, hash: "cc6abb007854228a3074a52213d54a77cc285257235952fb0f4829364483a51d" },
    ],
  },
  {
    // Re-sealed 2026-07-10: prayers rebuilt as 3d6 COMPOUND generators
    // (flags.shadowdark-enhancer.compound, 3 cols × d6 — see compound-table.mjs).
    id: "wr-god-prayers", name: "Western Reaches God Prayers", type: "Table", coversType: "Table", source: "WR", pages: "190-205",
    file: `modules/${MODULE_ID}/data/locked/wr-god-prayers.json`,
    anchors: [
      { len: 5, hash: "c4923a8668b8a5c51c7fd5347a5f9a524104d0e7141ad42c00a2be2ab935a746" },
      { len: 7, hash: "be87560f84067fc80c2d9845f4301f4ebdbdc1c29191d2802f3a514eceb72629" },
      { len: 4, hash: "4363186dce20a11a1d66645dbca9ff7c256ceeea79226eac1a21448eb6342d19" },
      { len: 7, hash: "ff56b652ba3fbcf614362e3e2c8319dc39dd0d2816447da201eb046c0e25fd06" },
      { len: 5, hash: "22dcec8feeb198f917e6502c621d53e2476cb794c784e40c198f1764cb3288fa" },
    ],
  },
  {
    // Re-sealed 2026-07-10: WR-version boon tables in the SYSTEM's format —
    // 77 docs: 16 tables (doc-linked results) + 45 boon Talents + 16 Patron
    // items (system.boonTable). Kytheros stays a system link (unrevised in WR).
    id: "wr-patron-boons", name: "Western Reaches Patron Boons", type: "Table", coversType: "Table", source: "WR", pages: "206-223",
    file: `modules/${MODULE_ID}/data/locked/wr-patron-boons.json`,
    anchors: [
      { len: 5, hash: "ccc6cddd815dfe2d4a583b854383a7fccf209f7469b6a0521d01c457ca31c1ef" },
      { len: 7, hash: "3fbc63094217680f8e945dac65a478013b8e9821d7e75364c116ddd7e30359c8" },
      { len: 7, hash: "5c3999f2701a13a99f634e2b26943a6d1b27564768acf25f9fc04d1a6565a79c" },
      { len: 6, hash: "8d9d287c4ab057e19b715edf727584289bc1b714e4fa0adf53621325e6e530ef" },
      { len: 10, hash: "5555f572f010c29acd590020d35179c2655a43ef3693a138a79a29e43f5606fe" },
    ],
  },
];

/** Lowercase, strip everything but letters/digits, collapse spaces. */
export function normalizeKeyText(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

async function _sha256Hex(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function _aesKey(material, usage) {
  const bits = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
  return crypto.subtle.importKey("raw", bits, { name: "AES-GCM" }, false, [usage]);
}

const _b64 = (u8) => {
  // Chunked to avoid a call-stack overflow from spreading a large payload into
  // String.fromCharCode (big units — e.g. the 22-table core encounter set — blow
  // the stack otherwise). 0x8000-byte windows keep each apply() call safe.
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
};
const _unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/**
 * Locate the unit's anchors inside a paste. The module knows only each
 * anchor's token length + hash; we slide a token window over the normalized
 * paste and hash candidates. Returns { found, total, material } — material
 * (the recovered plaintext anchors, joined) only when all are found.
 */
export async function findAnchors(unit, pasteText) {
  const tokens = normalizeKeyText(pasteText).split(" ");
  const recovered = [];
  let found = 0;
  for (const a of unit.anchors) {
    let hit = null;
    for (let i = 0; i + a.len <= tokens.length; i++) {
      const cand = tokens.slice(i, i + a.len).join(" ");
      // eslint-disable-next-line no-await-in-loop
      if (await _sha256Hex(cand) === a.hash) { hit = cand; break; }
    }
    if (hit) { found++; recovered.push(hit); } else recovered.push(null);
  }
  return { found, total: unit.anchors.length, material: found === unit.anchors.length ? recovered.join("|") : null };
}

/** Try to decrypt a unit with a paste. → { ok, payload?, found, total } */
export async function tryUnseal(unit, pasteText) {
  const { found, total, material } = await findAnchors(unit, pasteText);
  if (!material) return { ok: false, found, total };
  try {
    // .enc files are base64 text (repo-friendly); iv is the first 12 bytes.
    const u8 = _unb64((await (await fetch(unit.file)).text()).trim());
    const iv = u8.slice(0, 12);
    const key = await _aesKey(material, "decrypt");
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, u8.slice(12));
    return { ok: true, payload: JSON.parse(new TextDecoder().decode(plain)), found, total };
  } catch (err) {
    console.error(`${MODULE_ID} | unseal ${unit.id} failed:`, err);
    return { ok: false, found, total, error: "decrypt" };
  }
}

/**
 * DEV: seal a payload. anchors = plaintext phrases (normalized internally).
 * Returns { encBase64, anchorsMeta } — write the file + registry entry by hand.
 */
export async function sealUnit(payload, anchorPhrases) {
  const norm = anchorPhrases.map(normalizeKeyText);
  const anchorsMeta = [];
  for (const a of norm) anchorsMeta.push({ len: a.split(" ").length, hash: await _sha256Hex(a) });
  const material = norm.join("|");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await _aesKey(material, "encrypt");
  const enc = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key,
    new TextEncoder().encode(JSON.stringify(payload))));
  const out = new Uint8Array(iv.length + enc.length);
  out.set(iv); out.set(enc, iv.length);
  return { encBase64: _b64(out), anchorsMeta };
}

/** Compendium folder path ("Class/Roustabout") for a live doc, or null. */
function _sealFolderPath(doc) {
  const pack = doc.compendium ?? game.packs.get(doc.pack);
  let fid = doc.folder?.id ?? doc.folder ?? null;
  const parts = [];
  while (fid && pack) {
    const f = pack.folders.get(fid);
    if (!f) break;
    parts.unshift(f.name);
    fid = f.folder?.id ?? f.folder ?? null;
  }
  return parts.length ? parts.join("/") : null;
}

const _WORLD_REF = /Compendium\.world\.[\w-]+\.[A-Za-z]+\.[A-Za-z0-9]{16}/g;

/**
 * DEV: capture a unit's CURRENT live docs into a seal payload. Starts from
 * `roots` (uuids — usually a class), follows every world-pack reference to a
 * transitive closure, then topologically sorts so a referenced doc always
 * precedes its referencer (import creates in order, remapping @@LOCAL tokens as
 * uuids become known). Intra-unit refs → @@LOCAL:n@@; system/other refs stay
 * literal. Folder paths are captured from the live structure. Pass
 * `bundleSpellsForClass` (a class uuid) to also pull in every world.spells doc
 * that lists that class — spells reference the class, not vice-versa, so they
 * aren't reachable by traversal (Necromancer's own list; Green Knight's druid
 * list). Returns { docs } for sealUnit — never leaves prose in the caller.
 */
export async function captureUnitPayload({ roots = [], bundleSpellsForClass = null, rootsOnly = false } = {}) {
  // Accept suite-pack refs (Compendium.world.*) AND bare world-directory roots
  // (e.g. "RollTable.<16id>" from game.tables — some curated core tables live
  // there, not in a pack). Never matches system packs (Compendium.shadowdark.*),
  // so traversal/roots stay scoped to the user's own content.
  const isWorld = (u) => typeof u === "string" &&
    (/^Compendium\.world\./.test(u) || /^[A-Z][A-Za-z]+\.[A-Za-z0-9]{16}$/.test(u));
  const docs = new Map();       // uuid -> live doc
  const refs = new Map();       // uuid -> Set(world refs inside it)
  const queue = [...roots];
  if (bundleSpellsForClass) {
    // Spells live in the sde-items suite pack (type:"Spell"), not a dedicated
    // "world.spells" collection — the old hardcoded pack no longer exists.
    const { findSuitePack } = await import("./compendium-suite.mjs");
    const pack = findSuitePack("sde-items") ?? game.packs.get("world.spells");
    for (const s of (pack ? await pack.getDocuments() : [])) {
      if (s.type !== "Spell") continue;
      let c = s.system.class; c = Array.isArray(c) ? c : (c ? [c] : []);
      if (c.includes(bundleSpellsForClass)) queue.push(s.uuid);
    }
  }
  while (queue.length) {
    const u = queue.shift();
    if (!isWorld(u) || docs.has(u)) continue;
    // eslint-disable-next-line no-await-in-loop
    const d = await fromUuid(u).catch(() => null);
    if (!d) continue;
    docs.set(u, d);
    const found = new Set();
    // rootsOnly: capture just the given docs, don't follow world refs. Needed
    // for spell units — a spell references its class(es), and traversal would
    // otherwise pull the whole (separately-sealed) class into the spell unit.
    if (!rootsOnly) for (const m of JSON.stringify(d.toObject()).matchAll(_WORLD_REF)) { found.add(m[0]); queue.push(m[0]); }
    refs.set(u, found);
  }

  // Topological order (refs first). A cycle just stops recursing — import's
  // token remap tolerates a not-yet-created target by leaving it empty.
  const inSet = new Set(docs.keys());
  const order = [];
  const state = new Map();
  const visit = (u) => {
    if (state.get(u)) return;                 // visiting(1) or done(2)
    state.set(u, 1);
    for (const r of (refs.get(u) || [])) if (inSet.has(r) && r !== u) visit(r);
    state.set(u, 2); order.push(u);
  };
  for (const u of docs.keys()) visit(u);

  const idx = new Map(order.map((u, i) => [u, i]));
  const out = [];
  for (const u of order) {
    const d = docs.get(u);
    const data = d.toObject();
    for (const k of ["_id", "_stats", "ownership", "sort", "folder"]) delete data[k];
    let json = JSON.stringify(data);
    for (const [refU, refI] of idx) if (refU !== u) json = json.split(refU).join(`@@LOCAL:${refI}@@`);
    const kind = d.documentName === "RollTable" ? "RollTable"
      : d.documentName === "Actor" ? "Actor" : "Item";
    out.push({ kind, data: JSON.parse(json), folder: _sealFolderPath(d) });
  }
  return { docs: out };
}

/** Rewrite "@@LOCAL:n@@" tokens using the created-uuid map. */
function _remap(value, uuids) {
  if (typeof value === "string") return value.replace(/@@LOCAL:(\d+)@@/g, (_, n) => uuids[Number(n)] ?? "");
  if (Array.isArray(value)) return value.map((v) => _remap(v, uuids));
  if (value && typeof value === "object") {
    const o = {};
    for (const [k, v] of Object.entries(value)) o[k] = _remap(v, uuids);
    return o;
  }
  return value;
}

/**
 * Import an unsealed payload: create docs in dependency order (payload.docs
 * are topologically ordered at seal time), remapping local links as uuids
 * become known. Items → sde-items pack, RollTables → sde-tables pack (with
 * folder). Returns created doc uuids.
 */
/**
 * Item document type → suite pack descriptor id. Character-builder content is
 * routed to its own pack (mirroring the reorg'd world); gear (Basic/Weapon/
 * Armor/…) falls back to sde-items.
 */
const SEALED_ITEM_PACK = {
  Class: "classes",
  Talent: "talents",
  "Class Ability": "class-abilties",
  Spell: "spells",
  Background: "background",
  Ancestry: "ancestries",
  Patron: "patrons-and-deities",
  Deity: "patrons-and-deities",
};

export async function importSealedPayload(payload) {
  const { ensureSuite, findSuitePack } = await import("./compendium-suite.mjs");
  await ensureSuite();
  const itemPack = findSuitePack("sde-items") ?? game.packs.get("world.shadowdark-enhancer--items");
  const tablePack = findSuitePack("sde-tables") ?? game.packs.get("world.shadowdark-enhancer--roll-tables");
  const actorPack = findSuitePack("sde-actors") ?? game.packs.get("world.shadowdark-enhancer--actors");
  // Route an Item to its type-specific pack (falls back to sde-items for gear).
  const packForItem = (type) => (SEALED_ITEM_PACK[type] && findSuitePack(SEALED_ITEM_PACK[type])) || itemPack;
  const uuids = [];
  const created = [];
  // Folder paths ("Talents/Class") recreate the user's compendium taxonomy —
  // documents are NEVER left at pack root (standing user directive).
  const ensureFolder = async (pack, path, type) => {
    let parent = null;
    for (const part of String(path).split("/")) {
      let fo = pack.folders.find((x) => x.name === part && (x.folder?.id ?? null) === (parent?.id ?? null));
      if (!fo) fo = await Folder.create({ name: part, type, folder: parent?.id ?? null }, { pack: pack.collection });
      parent = fo;
    }
    return parent;
  };
  for (const entry of payload.docs) {
    const data = _remap(entry.data, uuids);
    // Idempotent: a doc of the same name/type already in the pack is reused,
    // so re-unlocks and units sharing docs (e.g. two classes, one weapon)
    // never duplicate.
    let doc;
    if (entry.kind === "Item") {
      const pack = packForItem(data.type);
      const idx = await pack.getIndex({ fields: ["type"] });
      const e = idx.find((x) => x.name === data.name && x.type === data.type);
      if (e) { uuids.push(`Compendium.${pack.collection}.Item.${e._id}`); created.push({ kind: entry.kind, name: data.name, uuid: uuids.at(-1), reused: true }); continue; }
      if (entry.folder) data.folder = (await ensureFolder(pack, entry.folder, "Item")).id;
      [doc] = await Item.createDocuments([data], { pack: pack.collection });
    } else if (entry.kind === "RollTable") {
      const idx = await tablePack.getIndex();
      const e = idx.find((x) => x.name === data.name);
      if (e) { uuids.push(`Compendium.${tablePack.collection}.RollTable.${e._id}`); created.push({ kind: entry.kind, name: data.name, uuid: uuids.at(-1), reused: true }); continue; }
      const folderId = entry.folder ? (await ensureFolder(tablePack, entry.folder, "RollTable")).id : null;
      [doc] = await RollTable.createDocuments([{ ...data, folder: folderId }], { pack: tablePack.collection });
    } else if (entry.kind === "Actor") {
      const idx = await actorPack.getIndex();
      const e = idx.find((x) => x.name === data.name);
      if (e) { uuids.push(`Compendium.${actorPack.collection}.Actor.${e._id}`); created.push({ kind: entry.kind, name: data.name, uuid: uuids.at(-1), reused: true }); continue; }
      const folderId = entry.folder ? (await ensureFolder(actorPack, entry.folder, "Actor")).id : null;
      [doc] = await Actor.createDocuments([{ ...data, folder: folderId }], { pack: actorPack.collection });
    }
    uuids.push(doc?.uuid ?? "");
    created.push({ kind: entry.kind, name: doc?.name, uuid: doc?.uuid });
  }
  return created;
}

/** Sealed unit matching a manifest/census entry: by name, or by a set-level
 *  unit covering the entry's document type (e.g. any Background → the full
 *  backgrounds set). */
export function sealedUnitFor(name, type = null) {
  return SEALED_UNITS.find((u) => u.anchors.length && u.name.toLowerCase() === String(name).toLowerCase())
    ?? (type ? SEALED_UNITS.find((u) => u.anchors.length && u.coversType === type) ?? null : null);
}

/**
 * Ordered candidate units for a census/manifest entry — a paste is tried
 * against each until one unseals. Handles MULTIPLE set-level units of the same
 * type (e.g. per-book Spell units CS4/CS5/CS6/WR) that `sealedUnitFor` can't
 * disambiguate: exact name (classes) → same coversType AND same source (the
 * right book) → same coversType any source (single-set types / src fallback).
 * The anchors guarantee correctness — only the matching book's paste satisfies
 * a unit's phrases — so trying extra candidates is safe.
 */
export function sealedUnitsFor({ name = "", type = null, source = null } = {}) {
  const live = SEALED_UNITS.filter((u) => u.anchors.length);
  const out = [];
  const push = (u) => { if (u && !out.includes(u)) out.push(u); };
  // coversType may be a single type or an array (e.g. wr-gear covers Basic/Weapon/Armor).
  const covers = (u, t) => Array.isArray(u.coversType) ? u.coversType.includes(t) : u.coversType === t;
  push(live.find((u) => u.name.toLowerCase() === String(name).toLowerCase()));
  if (type) {
    if (source) for (const u of live) if (covers(u, type) && u.source === source) push(u);
    for (const u of live) if (covers(u, type)) push(u);
  }
  return out;
}
