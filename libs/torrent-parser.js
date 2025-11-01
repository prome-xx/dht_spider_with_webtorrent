/**
 * 辅助函数：将 WebTorrent 的 torrent.files 数组转换为紧凑的嵌套数组结构。
 *
 * 文件格式: [name, size]
 * 目录格式: [name, [children_array]] (文件夹没有 size 字段)
 *
 * @param {Array<Object>} torrentFiles - WebTorrent 解析后的 torrent.files 数组。
 * 每个文件对象应至少包含 { path: string, length: number }。
 * @returns {Array<Array<any>>} 转换后的紧凑树状结构。
 */
export function files2arr(torrentFiles) {
    const root = [];
    const pathMap = new Map(); // pathMap: 存储目录的完整路径到其子数组的引用，方便快速查找

    torrentFiles.forEach(file => {
        const normalizedPath = file.path.replace(/\\/g, '/'); // 将所有反斜杠替换为正斜杠
        const parts = normalizedPath.split('/');

        let currentChildren = root; // 当前层级的子数组
        let currentFullPath = ''; // 当前目录的完整路径
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            const isFile = (i === parts.length - 1);
            if (isFile) {
                currentChildren.push([part, file.length]);
            } else {
                currentFullPath = currentFullPath ? `${currentFullPath}/${part}` : part;
                let nextChildren = pathMap.get(currentFullPath);
                if (!nextChildren) {
                    // 如果目录尚未创建，则创建并加入当前层级
                    const newDirEntry = [part, []]; // <-- 修改点：移除了 '0'
                    currentChildren.push(newDirEntry);
                    nextChildren = newDirEntry[1]; // <-- 修改点：索引从 2 变为 1
                    pathMap.set(currentFullPath, nextChildren);
                }
                currentChildren = nextChildren; // 移动到下一层级
            }
        }
    });
    return root;
}

/**
 * 接收一个 WebTorrent 的 torrent 对象，并返回包含其关键信息的结构化 JSON。
 * @param {Object} torrent - WebTorrent 库的 Torrent 实例。
 * @returns {Object} 包含 torrent 名称、总大小、文件列表和对等点数量的 JSON 对象。
 */
export function parseTorrent(torrent) {
    return {
        infohash: torrent.infoHash,
        name: torrent.name,
        size: torrent.length,
        files: files2arr(torrent.files),
        peers: torrent.numPeers
    };
}