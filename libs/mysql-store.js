// mysql-store.js
'use strict';

import mysql from 'mysql'; // 确认 mysql 库的导出方式，通常是 default export

class MySQLStore {
    constructor(opts) {
        this.pool = mysql.createPool({
            host:     opts.host || 'localhost',
            user:     opts.user || 'root',
            password: opts.password || 'root',
            database: opts.database || 'dht',
            connectionLimit: 10
        });
    }

    save(metadata, callback) {
        const sql = 'INSERT IGNORE INTO torrents SET ?';
        this.pool.query(sql, {
            infohash: metadata.infohash,
            name: metadata.name,
            size: metadata.size,
            peers: metadata.peers,
            files: JSON.stringify( metadata.files )
        }, callback);
    }
}

export default MySQLStore;