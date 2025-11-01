// bloom-disk.js
'use strict';

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { BloomFilter } from 'bloomfilter';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ========== 默认配置 ==========
const DEFAULT_PATH = path.join(__dirname, '../bloom.bin');
const DEFAULT_INTERVAL = 60 * 1000;   // 60 秒

// 定义头部字节长度，用于存储 m 和 k
const HEADER_SIZE = 4 + 4; // m (Uint32) + k (Uint32) = 8 字节

// ========== 构造函数 ==========
class BloomDisk {
    constructor(opts) {
        opts = opts || {};
        this.filePath = opts.filePath || DEFAULT_PATH;
        this.saveInterval = opts.saveInterval || DEFAULT_INTERVAL;

        this.last_save_time = Date.now();

        const loaded = this._load();
        if (loaded) {
            this.bloom = loaded;
            //console.log("DEBUG (Constructor): BloomFilter loaded from file.");
        } else {
            this.bloom = new BloomFilter(
                opts.bits || Math.pow(2, 24), // 建议使用更合理的默认值，例如 2^24 bits
                opts.hashes || 7
            );
            //console.log("DEBUG (Constructor): New BloomFilter instance created.");
            // 调试信息：检查 newly created BloomFilter 的 buckets 属性
            //console.log("DEBUG (Constructor): Type of this.bloom.buckets:", typeof this.bloom.buckets);
            //console.log("DEBUG (Constructor): Is this.bloom.buckets an Int32Array?", this.bloom.buckets instanceof Int32Array);
            // console.log("DEBUG (Constructor): this.bloom.buckets value:", this.bloom.buckets); // 可能日志内容过多，请谨慎使用

            // 首次创建时立即保存，确保文件内容正确
            this.saveSync();
        }
    }

    // ========== 方法 ==========
    test(key) {
        return this.bloom.test(key);
    }

    add(key) {
        this.bloom.add(key);
    }

    saveSync() {
        this._save(true);
    }

    destroy() {
        if (this._timer) {
            clearInterval(this._timer);
            this._timer = null;
        }
    }

    startAutoSave() {
        if (this._timer) {
            clearInterval(this._timer);
        }
        this._timer = setInterval(this._save.bind(this), this.saveInterval);
    }

    // ========== 内部：二进制保存和加载 ==========
    _save(sync) {
        //console.log("DEBUG (_save): Entering _save method.");
        // 我们现在知道需要保存的是 this.bloom.buckets
        //console.log("DEBUG (_save): Type of this.bloom.buckets:", typeof this.bloom.buckets);
        //console.log("DEBUG (_save): Is this.bloom.buckets an Int32Array?", this.bloom.buckets instanceof Int32Array);

        // 确保 this.bloom.buckets 是一个有效的 TypedArray 或普通数组（如果 TypedArray 不可用）
        // 在 Node.js 环境下，通常会是 Int32Array
        if (!(this.bloom.buckets instanceof Int32Array) && !Array.isArray(this.bloom.buckets)) {
            console.error('[BloomDisk] _save Error: this.bloom.buckets is not an Int32Array or Array. Type:', typeof this.bloom.buckets, 'Value:', this.bloom.buckets);
            throw new TypeError("BloomFilter 'buckets' property is not valid. Cannot save.");
        }

        // 【核心修复】更稳妥地从 Int32Array 的底层 ArrayBuffer 创建 Buffer
        // 之前 Buffer.from(this.bloom.buckets) 可能会在某些 Node.js 版本或环境下行为不符合预期，
        // 导致只复制了元素的数量（length）而不是字节的数量（byteLength）。
        const bucketsBufferToSave = Buffer.from(
            this.bloom.buckets.buffer,
            this.bloom.buckets.byteOffset,
            this.bloom.buckets.byteLength
        );

        //console.log("DEBUG (_save): bucketsBufferToSave byteLength:", bucketsBufferToSave.length);

        const totalSize = HEADER_SIZE + bucketsBufferToSave.length;
        const dataBuffer = Buffer.alloc(totalSize);

        // 写入 m 和 k 到头部
        dataBuffer.writeUInt32BE(this.bloom.m, 0); // 在偏移量 0 写入 m (4字节大端无符号整数)
        dataBuffer.writeUInt32BE(this.bloom.k, 4); // 在偏移量 4 写入 k (4字节大端无符号整数)

        // 复制 buckets 的数据到 dataBuffer 的剩余部分
        bucketsBufferToSave.copy(dataBuffer, HEADER_SIZE);

        if (sync) {
            try {
                fs.writeFileSync(this.filePath, dataBuffer); // 直接写入 Buffer
            } catch (err) {
                console.error('[BloomDisk] saveSync error:', err);
            }
        } else {
            // 修复 fs.writeFile 缺少 filePath 参数的 bug
            fs.writeFile(this.filePath, dataBuffer, function (err) {
                if (err) console.error('[BloomDisk] save error:', err);
            });
        }
    }

    _load() {
        try {
            if (!fs.existsSync(this.filePath)) {
                console.log('[BloomDisk] bloom.bin file not found. Creating new Bloom Filter.');
                return null;
            }

            // 直接读取整个文件作为 Buffer
            const rawBuffer = fs.readFileSync(this.filePath);

            // 检查文件大小是否至少包含头部
            if (rawBuffer.length < HEADER_SIZE) {
                console.warn('[BloomDisk] Loaded file is too small to contain header. Creating new Bloom Filter.');
                return null;
            }

            // 从头部读取 m 和 k
            const m = rawBuffer.readUInt32BE(0);
            const k = rawBuffer.readUInt32BE(4);

            // 验证 m 和 k 的有效性
            if (m <= 0 || k <= 0 || k > 100) {
                console.warn('[BloomDisk] Loaded m or k value is invalid. Creating new Bloom Filter.');
                return null;
            }

            // 计算 buckets 数组应该占用的字节数 (Int32Array 每个元素 4 字节)
            const expectedBucketsBytes = Math.ceil(m / 32) * 4;

            if (rawBuffer.length !== HEADER_SIZE + expectedBucketsBytes) {
                // 【诊断信息】报告实际文件大小和期望文件大小
                console.warn(`[BloomDisk] Loaded file size mismatch with m value. Actual: ${rawBuffer.length} bytes, Expected: ${HEADER_SIZE + expectedBucketsBytes} bytes. Creating new Bloom Filter.`);
                return null;
            }

            // 从 Buffer 中切出 buckets 的数据，并创建 Int32Array
            const bucketsBuffer = rawBuffer.slice(HEADER_SIZE);
            const loadedBuckets = new Int32Array(bucketsBuffer.buffer, bucketsBuffer.byteOffset, bucketsBuffer.byteLength / 4);

            // 创建新的 BloomFilter 实例，它会初始化自己的空 buckets 数组
            const bloom = new BloomFilter(m, k);

            // 将加载的 buckets 数据赋值给新创建的 BloomFilter 实例的 buckets 属性
            if (loadedBuckets.length !== bloom.buckets.length) {
                console.warn('[BloomDisk] Reconstructed buckets length mismatch. Creating new Bloom Filter.');
                return null;
            }
            bloom.buckets = loadedBuckets; // 直接替换

            return bloom;

        } catch (e) {
            console.error('[BloomDisk] Error loading bloom.bin (binary):', e);
            return null;
        }
    }
}

// ========== 导出 ==========
export default BloomDisk;
