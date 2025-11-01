// webtorrent-crawler.js

'use strict';

import path from 'path';
import WebTorrent from 'webtorrent';
import { mkdirp } from 'mkdirp';
import {parseTorrent} from "./torrent-parser.js";
import { isJunkTorrent } from './junk-torrent-detector.js';
import crypto from 'crypto'; // 用于生成随机的节点 ID
import fs from 'fs'; // 引入 Node.js 文件系统模块
import { fileURLToPath } from 'url'; // 用于在 ES Modules 中获取 __dirname

// 模拟 __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getTorrentPath( str_dir,  infohash ) {
    const prefix = infohash.slice(0, 3).toLowerCase();
    const dir = path.join( str_dir, 'torrents', prefix[0], prefix[1], prefix[2]);
    mkdirp.sync(dir);
    return path.join(dir, infohash.toLowerCase() + '.torrent');
}

function decodeNodes(buf) {
    const nodes = [];
    for (let i = 0; i + 26 <= buf.length; i += 26) {
        try {
            const id = buf.slice(i, i + 20);
            const host = `${buf[i + 20]}.${buf[i + 21]}.${buf[i + 22]}.${buf[i + 23]}`;
            const port = buf.readUInt16BE(i + 24);
            nodes.push({ id, host, port });
        } catch (e) {
            console.warn('[decodeNodes] 解码节点失败:', e.message);
            // 忽略格式错误的节点
        }
    }
    return nodes;
}

// 默认的热门种子，可以作为初始 infohash 注入到客户端进行爬取
const DEFAULT_HOT_SEEDS = [
    "D37D631A08AB3CE1AC6E73A28E77D569AF77A575",
    "00F4A055C72045C1B355312BCA67A5D77CB6EC70",
    "5D3391505D45E6673A6FE7070D6A98CE8F9F5B1C",
    "51A51B9BDF915EB7FA23E70731CF8FFC8C652D5B",
    "a111ab678ac061d19dcbd0c281750d6f7fbeca3d",
    '2EE5DD8285167C3D6538FE2CB3CDCB2FDFE5AD79',
    'FBE4A9D0C1294120835A8400C89746DD4E6734CD',
    'B1E9CDA314730B132727C9F4FEEE2EB3E780A84B',
    "0EA8759A8FBBA80C4AC9898DC4F3048466490234",
    "C37C904C8BC99EF12A674B105748CDB3F6609E04",
    "EA60FC2DE802D40E0CB08DB06B455F647FE33D4D",
    "7430C9E57AD18B79BD7C2D5465B9830BB4532E48",
    "B64386072F4647A4516EDBBC88977F3E64FE1AEA",
    "A91AC4C642DDB2E677048BDEAECCEDFEBA5E8346",
    "A88BDF0E62D35DAB4B2828E6B0C15D677C70F2E4",
    "EE95ED65A358FAF9BD48008AA340995E27BEAFBE",
    "2A5F34F4DB992100490DE884D6253F35B0B6868D",
    "A58F9A7168874568CF73A1CC8184E52D5859F271",
    "2BA9779A5F8094B35B4CEF7E097E2589F1DADF71",
    "D92D63677029FDE57A7DD64C55754E95B8F3B761",
    "26336CF7130DEB09BA91E41896724A692F04F6B7",
    "E90FD67DC2D7FFCE4042C2FFBE66ABC3C3515790",
    "CE019FF80ABBC8524FAFED1E64838199672BB58E",
    "b8bcfdeece362187b1cb1484e3306b5d4ca7ef3b",
    "dd9b3babb66e1481e1cb0dd2c5ca0d1a6ac2821b",
    "bc0480aca6aeb49c2df9ce5d8ec8638d64f98fa6",
    "f68eb62fab9fed06c9de3abccb2772ca8e1c065c",
    "61A89A9CFC4F223E6C24C8A6930AC1FD067EF4BE",
    "C1F239735AD87F00712CA3AF6E50B788FE66FC26",
    "66CBC985E53E18341127277E9B7EDA13BA4EE230",
    "FF02281C4D7B55D6E498C457BD94362AAE189E7D",
    "AF86C88E059C253809C67B77A85F584C5449DC9C",
    "5694bf863b1d3bcdb67dde2184e199c530996f6d",
    "284215a3c86591933c02f7bca1119dfeded07704"
];

var DEFAULT_HOT_SEEDS_MAP = {};
DEFAULT_HOT_SEEDS.forEach(function(infohash){
    DEFAULT_HOT_SEEDS_MAP[infohash] = 1;
})

const DEFAULT_TORRENT_DIR = '../torrents';
const DEFAULT_ROUTING_TABLE_FILE = path.join('../data', 'dht_routing_table.json');
const ROUTING_TABLE_SAVE_INTERVAL_MS = 60 * 1000; // 默认每 60 秒保存一次

class WebTorrentCrawler {
    constructor(opts) {
        opts = opts || {};

        this.port = opts.port;
        this.bloom = opts.bloom; // BloomDisk 实例
        this.mysqlStore = opts.mysqlStore; // MySQLStore 实例
        this.hotSeeds = opts.hotSeeds || DEFAULT_HOT_SEEDS;
        this.torrent_dir = opts.torrent_dir || DEFAULT_TORRENT_DIR;
        this.max_torrents_downlading = opts.max_torrents_downlading || 200;    //最大同时下载种子数
        this.torrent_metadata_timeout = 30e3;                                 //下载种子超时时间
        this.min_torrent_content_size = 10 * 1024 * 1024;                     //10m以下种子不要

        // 路由表文件路径和保存定时器ID
        this.routingTableFilePath = opts.routingTableFilePath || DEFAULT_ROUTING_TABLE_FILE;
        this.routingTableSaveIntervalId = null;


        this.start_time = Date.now();
        this.torrent_download = 0;
        this.torrent_saved = 0;
        this.torrent_fail = 0;
        this.torrent_ignore = 0;  //垃圾种子忽略

        this.torrent_download_map = {};

        // 初始化 WebTorrent 客户端
        this.client = new WebTorrent({
            maxConns:100,
            dht: {
                port: this.port,
                tracker:{
                    annouce:[
                        'udp://tracker.opentrackr.org:1337/announce',
                        'udp://open.demonii.com:1337/announce',
                        'udp://p4p.arenabg.com:1337/announce',
                        'udp://open.stealth.si:80/announce',
                        'udp://tracker.torrent.eu.org:451/announce',
                        'udp://tracker.dler.org:6969/announce',
                        'udp://tracker1.myporn.club:9337/announce'
                    ]
                }
                // bootstrap: WebTorrent 默认有自己的引导节点，也可以在这里添加自定义引导节点
            },
            webSeeds: true, // 禁用 WebSeeds
            utp: true, // 启用 uTP (UDP-based Transport Protocol) for better NAT traversal
            downloadLimit: 5000 * 1024 * 1024,   // Max download speed (bytes/sec) over all torrents (default=-1)
            uploadLimit: 500 * 1024,     // Max upload speed (bytes/sec) over all torrents
        });

        this.client.on('error', (err) => {
            console.error(`[WebTorrentCrawler_ERROR] ${err.message}`);
        });

        var self = this;
        var dht = this.client.dht;

        // === 路由表加载逻辑 ===
        const initialNodes = self._loadRoutingTableSync();
        if (initialNodes.length > 0) {
            console.log('将加载的节点添加到 DHT...');
            initialNodes.forEach(node => {
                if (node.host && node.port && node.id) {
                    // 使用 dht.addNode 方法添加到路由表
                    dht.addNode({ host: node.host, port: node.port, id: node.id });
                }
            });
            console.log(`已将 ${initialNodes.length} 个节点从保存的文件添加到 DHT。`);
        }
        // === 路由表加载逻辑结束 ===

        // === 路由表保存定时器 ===
        self.routingTableSaveIntervalId = setInterval(() => {
            self._saveRoutingTableSync();
        }, ROUTING_TABLE_SAVE_INTERVAL_MS);
        // === 路由表保存定时器结束 ===

        dht.on('peer', (addr, infoHash) => {
            var str_infohash = infoHash.toString('hex');
            //console.log( 'onPeer:', str_infohash, addr);
            self.download( str_infohash );
        });
        dht.on('announce', (addr, infoHash, port) => {
            var str_infohash = infoHash.toString('hex');
            //console.log( 'announce:', str_infohash, addr);
            self.download( str_infohash );
        })

        self._setWalker(); // 设置 DHT 漫步器，开始主动发现节点
        this._setHotInfohash(); // 注入初始的热门种子
        this._setAnnouceTimer(); // 设置定时宣布热门种子

        // 客户端在构造函数中已经配置并启动了 DHT 监听
        console.log(`[WebTorrentCrawler] 客户端在端口 ${this.port} 初始化并加入 DHT 网络。`);
    }

    __getDownloadingTorrents(){
        var num = 0;
        for(var i=0; i<this.client.torrents.length; i++){
            if(this.client.torrents[i].progress < 1){ // 修正：torrent.progress 应该是 torrents[i].progress
                num ++;
            }
        }
        return num;
    }

    //做种中的种子
    __getDownloadedTorrents(){
        var num = 0;
        for(var i=0; i<this.client.torrents.length; i++){
            if(this.client.torrents[i].progress == 1){ // 修正
                num ++;
            }
        }
        return num;
    }

    __checkInfohashInTorrentList( infohash ){
        for (var torrent of this.client.torrents) {
            if (torrent.infoHash == infohash ) return torrent
        }
        return null; // 如果未找到，返回 null
    }

    download(infohash){
        if( this.__getDownloadingTorrents() >= this.max_torrents_downlading ){
            //console.log('正在下载的torrent超过20,所以不下载');
            return;
        }
        if( this.torrent_download_map[infohash] || DEFAULT_HOT_SEEDS_MAP[infohash] || this.__checkInfohashInTorrentList(infohash)){
            //这个检测没用。 因为 add时， torrent未必有 infohash属性
            //这个异步未必是JS单线程的异步，不加最后一个判断，会不停的报添加重复种子
            //console.log( '当前种子正在下载，无法再次添加:' );
            return;
        }
        if(this.bloom && this.bloom.test(infohash)){ // 确保 bloom 存在
            //console.log( '布隆过滤器过滤了 infohash:', infohash );
            return;
        }
        //console.log( this.port, '添加下载:', infohash );
        this.torrent_download_map[infohash] = 1;
        this.torrent_download ++;

        var self = this;
        var torrent = this.client.add(infohash, { store:false, destroyStoreOnDestroy: true });
        torrent.handler_timeout = setTimeout(function(){
            self.torrent_fail ++;
            delete self.torrent_download_map[infohash];
            //console.warn(`[WebTorrentCrawler] 获取元数据超时: ${infohash}`);
            torrent.destroy();
        }, this.torrent_metadata_timeout)
        torrent.on('metadata', function () {
            //console.log('成功获取到元数据！', torrent.infohash, torrent.name);
            clearTimeout( torrent.handler_timeout );
            if(isJunkTorrent(torrent)){
                //console.log( "垃圾种子" );
                self.bloom.add( infohash );
                self.torrent_ignore ++;
                delete self.torrent_download_map[infohash];
                torrent.destroy();
                return;
            }
            var metadata = parseTorrent(torrent);
            // 检查内容大小
            self.mysqlStore.save(metadata, function(err){ // 添加错误回调
                if (err) {
                    //console.error(`[WebTorrentCrawler] 保存元数据到 MySQL 失败: ${err.message}`);
                    self.torrent_fail++;
                } else {
                    //console.log('入库成功::', infohash);
                    self.torrent_saved ++;
                }
                self.bloom.add( infohash );
                clearTimeout(torrent.handler_timeout);
                delete self.torrent_download_map[infohash];
                torrent.destroy(); // 不管成功失败都销毁种子，避免占用资源
            })
        });
        torrent.on('error', function (err) {
            self.torrent_fail ++;
            console.error('Torrent 发生错误:', err.message);
            delete self.torrent_download_map[infohash];
            clearTimeout(torrent.handler_timeout);
            torrent.destroy()
        });
    }

    _setHotInfohash(){
        var self = this;
        // 确保 client.dht 已经初始化，否则 add 无法找到 peers
        DEFAULT_HOT_SEEDS.forEach(function(infohash){
            // 仅当此 infohash 不在当前客户端管理中时才添加
            self.client.add(infohash, { store:false }, function(torrent){});
        });
    }

    // 注入初始的热门种子，让客户端尝试获取其元数据
    _setAnnouceTimer() {
        // 定时随机宣布一个热门种子，保持活跃，并可能发现更多peers
        var dht = this.client.dht;
        var self = this;
        this.announceTimer = setInterval(() => {
            const randomInfoHash = self.hotSeeds[Math.floor(Math.random() * self.hotSeeds.length)];
            // 使用 `dht.announce` 而不是 `client.add` 来直接宣布 infohash
            // 这更能体现“活跃” DHT 参与者的行为，并且不会产生 Torrent 实例的开销
            dht.announce(Buffer.from(randomInfoHash, 'hex'), self.port, (err) => {
                if (err) {
                    // console.warn(`DHT 宣布 ${randomInfoHash} 失败: ${err.message}`);
                } else {
                    // console.log(`DHT 成功宣布 ${randomInfoHash}`);
                }
            });
        }, 1 * 60 * 1000); // 每 10 分钟随机“探测”一个热门种子
    }

    _setWalker(){
        // 确保 DHT 实例已存在
        var dht = this.client.dht;
        this.walkTimer = setInterval(() => {
            var randomTargetId = crypto.randomBytes(20);
            dht.lookup(randomTargetId,  (err, nodes) => {
                //console.log( 'lookup::', err,  nodes ? nodes.length :0 );
                if (err) {
                    return;
                }
            });
            /*
            const nodesInTable = dht._rpc && dht._rpc.nodes ? dht._rpc.nodes.toArray() : [];
            if (nodesInTable.length === 0) {
                return;
            }
            const targetNode = nodesInTable[Math.floor(Math.random() * nodesInTable.length)];
            dht._rpc.query(targetNode, {
                q: 'find_node',
                a: {
                    id: dht.nodeId,
                    target: randomTargetId
                }
            }, (err, response, fromNode) => {

            });
             */
        }, 1000); // 每 1 秒发送一次 lookup 查询
    }

    /**
     * 处理 find_node 查询的响应。
     * @param {Error} err
     * @param {Object} response
     * @param {Object} fromNode
     * @param {function} cb
     * @private
     */
    _handleFindNodeResponse(err, response, fromNode, cb) {
        const self = this;
        if (err) {
            // console.warn(`[DHT_WALK_ERR] 端口 ${self.port}: find_node 响应失败 (来自 ${fromNode ? fromNode.host + ':' + fromNode.port : '未知'}): ${err.message}`);
            return cb(err);
        }

        if (!response.r || !response.r.nodes) {
            // console.warn(`[DHT_WALK_ERR] 端口 ${self.port}: 收到无效的 find_node 响应 (来自 ${fromNode ? fromNode.host + ':' + fromNode.port : '未知'})`);
            return cb(new Error('Invalid find_node response'));
        }

        const decodedNodes = decodeNodes(response.r.nodes); // 解码响应中的节点列表
        let nodesAdded = 0;

        self._debug(`[DHT_WALK] 端口 ${self.port}: 从 ${fromNode ? fromNode.host + ':' + fromNode.port : '未知'} 收到 ${decodedNodes.length} 个节点。`);

        decodedNodes.forEach(node => {
            // 确保节点有ID，并且不重复，再添加到路由表
            // addNode 内部会处理重复和 ping 验证
            if (node.id) { // 确保节点有ID
                self.dht.addNode(node); // 使用现有的 addNode 方法将新节点添加到路由表
                nodesAdded++;
            }
        });

        self._debug(`[DHT_WALK] 端口 ${self.port}: find_node walk 完成，添加了 ${nodesAdded} 个新节点。`);
        cb(null, nodesAdded);
    }

    /**
     * 同步加载保存的 DHT 路由表节点。
     * @returns {Array} 加载的节点数组。
     */
    _loadRoutingTableSync() {
        try {
            console.log('try load::', this.routingTableFilePath);
            if (!fs.existsSync(this.routingTableFilePath)) {
                console.log('[WebTorrentCrawler] 路由表文件未找到。将从头开始。');
                return [];
            }

            const data = fs.readFileSync(this.routingTableFilePath, 'utf8');
            const serializableNodes = JSON.parse(data);

            // 将十六进制字符串转换回 Buffer
            const loadedNodes = serializableNodes.map(node => ({
                host: node.host,
                port: node.port,
                id: node.id ? Buffer.from(node.id, 'hex') : null
            })).filter(node => node.host && node.port && node.id); // 过滤掉不完整的节点

            console.log(`[WebTorrentCrawler] 从 ${this.routingTableFilePath} 加载了 ${loadedNodes.length} 个节点。`);
            return loadedNodes;
        } catch (error) {
            console.error('[WebTorrentCrawler] 加载路由表时发生错误:', error);
            // 如果加载失败，返回空数组，让程序从头开始引导
            return [];
        }
    }

    /**
     * 同步保存当前的 DHT 路由表节点到文件。
     */
    _saveRoutingTableSync() {
        if (!this.client.dht) {
            console.warn('[WebTorrentCrawler] DHT 实例未准备好，无法保存路由表。');
            return;
        }
        const nodes = this.client.dht.nodes.toArray();

        // 将 Buffer 类型的 Node ID 转换为十六进制字符串以便 JSON 序列化
        const serializableNodes = nodes.map(node => ({
            host: node.host,
            port: node.port,
            id: node.id ? node.id.toString('hex') : null
        }));

        try {
            fs.writeFileSync(this.routingTableFilePath, JSON.stringify(serializableNodes, null, 2));
            console.log(`[WebTorrentCrawler] 路由表已保存到 ${this.routingTableFilePath}，包含 ${serializableNodes.length} 个节点。`);
        } catch (error) {
            console.error('[WebTorrentCrawler] 保存路由表时发生错误:', error);
        }
    }

    destroy() {
        if (this.announceTimer) {
            clearInterval(this.announceTimer);
            this.announceTimer = null;
        }
        if (this.walkTimer) {
            clearInterval(this.walkTimer);
            this.walkTimer = null;
        }
        if (this.routingTableSaveIntervalId) {
            clearInterval(this.routingTableSaveIntervalId);
            this.routingTableSaveIntervalId = null;
        }

        // 在销毁客户端前，确保保存最新的路由表状态
        console.log('[WebTorrentCrawler] 销毁前保存最终路由表状态...');
        this._saveRoutingTableSync();

        // 销毁 WebTorrent 客户端，关闭所有连接和监听
        this.client.destroy(() => {
            console.log(`[WebTorrentCrawler] 客户端在端口 ${this.port} 已销毁。`);
            // 如果是程序退出，确保进程退出
            if (process) process.exit(0);
        });
    }
}

export default WebTorrentCrawler;
