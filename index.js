import path from 'path';
import EventEmitter from 'events'
import WebTorrentCrawler from './libs/webtorrent-crawler.js'; // 导入新的 WebTorrentCrawler
import BloomDisk from './libs/bloom-disk.js';  
import MySQLStore from './libs/mysql-store.js'; 
import { fileURLToPath } from 'url';

import {formatTimestamp, formatTimeDelta} from './tools/time_tools.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

EventEmitter.defaultMaxListeners = 50;

// process 是 Node.js 的全局对象，无需导入

/* 1. 全局单例 */
const bloom  = new BloomDisk({ filePath: './data/bloom.bin', bits: Math.pow(2, 30), hashes: 7 });
const mysql  = new MySQLStore({ host: 'localhost', user: 'root', password: '123456', database: 'torrent_info' });

var port = 19001;
const routingTableFilePath = path.join(__dirname, 'data', `dht_routing_table_${port}.json`);
var crawler = new WebTorrentCrawler({ // 使用 WebTorrentCrawler
    port: port,
    bloom: bloom,        // 共用布隆
    mysqlStore: mysql,   // 共用 MySQL
    torrent_dir:path.join(__dirname, 'torrent'),
    routingTableFilePath:routingTableFilePath
});

// 移除 listen() 方法调用，WebTorrent 客户端在构造函数中已启动 DHT 监听
console.log(`[WebTorrentCrawler] 端口 ${port} 爬虫实例已准备。`); // 移动到这里

var log_handler = setInterval(function() {
    // 确保 DHT 实例存在且其 _rpc 属性（通常包含节点信息）也存在
    var now_time = Date.now();
    if(now_time - bloom.last_save_time > 5 * 60e3){
        bloom.last_save_time = now_time;
        bloom.saveSync();
    }
    if (crawler.client.dht && crawler.client.dht.nodes ) {
        var nodeCount = crawler.client.dht.nodes.count();
        console.log( formatTimestamp(now_time),  '  累计用时:', formatTimeDelta(now_time - crawler.start_time) );
        console.log(`[WebTorrentCrawler_DHT_NODES] : DHT 节点数量: ${nodeCount}`);
        console.log( '种子:  尝试下载', crawler.torrent_download, '入库:', crawler.torrent_saved, '失败:', crawler.torrent_fail, '忽略:', crawler.torrent_ignore  );
        console.log( '下载速度', crawler.client.downloadSpeed, ' 上传速度', crawler.client.uploadSpeed );
    } else {
        console.log(`[WebTorrentCrawler_DHT_NODES] 端口: DHT 尚未完全初始化或无节点信息。`);
    }
}, 1e3 );


process.on('SIGINT', () => {
    console.log('[App] 收到 SIGINT 信号，正在关闭爬虫...');
    crawler.destroy(); // 调用新的 destroy 方法
    // 等待所有客户端销毁完成再退出，或者强制退出
    // 这里简单地等待一小段时间，确保销毁操作开始
    bloom.saveSync();
    setTimeout(() => {
        process.exit(0);
    }, 5000); // 给点时间让客户端销毁
});
