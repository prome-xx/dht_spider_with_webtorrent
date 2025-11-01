// junk-torrent-detector.js

// --- 常量定义 ---
const MIN_TOTAL_SIZE_FOR_GOOD_TORRENT_BYTES = 10 * 1024 * 1024; // 10 MB

// 针对单一小型视频文件的规则
const MAX_SINGLE_VIDEO_SIZE_FOR_JUNK_BYTES = 100 * 1024 * 1024; // 100 MB

// 针对大量极小文件的规则
const MIN_FILES_FOR_MANY_SMALL = 100; // 文件数量超过此值才触发此规则
const SMALL_FILE_SIZE_THRESHOLD_BYTES = 1024; // 小于此大小的文件被认为是“极小文件” (1 KB)
const SMALL_FILES_PERCENTAGE_THRESHOLD = 0.8; // 极小文件占比超过 80%

// 针对特定填充文件的规则
const PADDING_FILE_PATTERN = /_____padding_file_/i; // 用于匹配 BitComet 填充文件的正则表达式

// 常见的视频文件扩展名集合
const COMMON_VIDEO_EXTENSIONS = new Set([
    '.mp4', '.mkv', '.avi', '.webm', '.mov', '.flv', '.wmv', '.mpg', '.mpeg',
    '.3gp', '.ogv', '.ts', '.vob', '.m4v', '.f4v', '.swf', '.rmvb', '.rm', '.asf'
]);


// --- 辅助函数 ---

/**
 * 检查给定文件名是否是常见的视频文件。
 * @param {string} filename - 文件的名称。
 * @returns {boolean} 如果是视频文件，返回 true；否则返回 false。
 */
function isVideoFile(filename) {
    const lastDotIndex = filename.lastIndexOf('.');
    if (lastDotIndex === -1) {
        return false; // 没有扩展名
    }
    const ext = filename.slice(lastDotIndex).toLowerCase();
    return COMMON_VIDEO_EXTENSIONS.has(ext);
}

/**
 * 判断一个种子是否是“垃圾种子” (junk torrent)。
 *
 * 规则：
 * 1. 种子总内容小于 10MB。
 * 2. 种子里只有一个文件，该文件是视频类型，且大小小于 100MB。
 * 3. 包含大量极小文件（文件数量超过 100 个，且超过 80% 的文件小于 1KB）。
 * 4. 包含特定填充文件（如 BitComet 填充文件）。
 *
 * @param {Object} torrentDetails - 包含种子信息的对象，例如：{name, peers, files:[{name, path, size}]}。
 * 此对象应由 torrent-parser.js 中的 reconstructTorrentDetails 函数生成。
 * @returns {boolean} 如果是垃圾种子返回 true，否则返回 false。
 */
export function isJunkTorrent(torrentDetails) {
    const files = torrentDetails.files;

    // 为了确保 isJunkTorrent 总是能获取到精确的总大小，这里从 files 数组中累加
    const totalSize = files.reduce((sum, file) => sum + file.size, 0);

    // 规则1: 文件总大小小于10MB
    if (totalSize < MIN_TOTAL_SIZE_FOR_GOOD_TORRENT_BYTES) {
        // console.log("Junk Rule 1: Total size < 10MB"); // 调试用
        return true;
    }

    // 规则2: 种子里只有一个文件，且该文件是视频，大小小于100MB
    if (files.length === 1) {
        const singleFile = files[0];
        if (isVideoFile(singleFile.name) && singleFile.size < MAX_SINGLE_VIDEO_SIZE_FOR_JUNK_BYTES) {
            // console.log("Junk Rule 2: Single video file < 100MB"); // 调试用
            return true;
        }
    }

    // 规则3: 包含大量极小文件
    if (files.length > MIN_FILES_FOR_MANY_SMALL) {
        let smallFileCount = 0;
        files.forEach(file => {
            if (file.size < SMALL_FILE_SIZE_THRESHOLD_BYTES) {
                smallFileCount++;
            }
        });
        if (smallFileCount / files.length >= SMALL_FILES_PERCENTAGE_THRESHOLD) {
            // console.log("Junk Rule 3: Too many very small files"); // 调试用
            return true;
        }
    }

    // 规则4: 包含特定填充文件 (BitComet padding files)
    for (const file of files) {
        if (PADDING_FILE_PATTERN.test(file.name)) {
            // console.log("Junk Rule 4: Contains specific padding file"); // 调试用
            return true;
        }
    }

    // 如果不符合以上任何垃圾种子的规则，则认为不是垃圾种子
    return false;
}