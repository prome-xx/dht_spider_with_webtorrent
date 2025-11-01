// base32-codec.js

// Base32 编码字符集 (RFC 4648)
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
// 用于解码的查找表，通过字符快速找到其对应的数值
const lookup = {};
for (let i = 0; i < alphabet.length; i++) {
    lookup[alphabet[i]] = i;
}

/**
 * 将 Node.js Buffer 或 Uint8Array 编码为 Base32 字符串。
 * @param {Buffer|Uint8Array} data 要编码的二进制数据。
 * @returns {string} Base32 编码字符串。
 * @throws {Error} 如果输入不是 Buffer 或 Uint8Array。
 */
function encode(data) {
    let bytes;
    // 检查是否为 Node.js Buffer，这是后端最常见的情况
    if (Buffer.isBuffer(data)) {
        bytes = data;
    } else if (data instanceof Uint8Array) {
        // 也支持 Uint8Array，以防万一
        bytes = data;
    } else {
        throw new Error("Input must be a Buffer or Uint8Array.");
    }

    let bits = 0;
    let value = 0;
    let output = '';
    let i = 0;

    for (i = 0; i < bytes.length; i++) {
        value = (value << 8) | bytes[i];
        bits += 8;
        while (bits >= 5) {
            output += alphabet[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    // 处理剩余的位
    if (bits > 0) {
        output += alphabet[(value << (5 - bits)) & 31];
    }

    // 添加填充字符（=），直到长度是8的倍数
    while ((output.length % 8) !== 0) {
        output += '=';
    }

    return output;
}

/**
 * 将 Base32 字符串解码为 Node.js Buffer。
 * @param {string} base32Str 要解码的 Base32 字符串。
 * @returns {Buffer} 解码后的二进制数据。
 */
function decode(base32Str) {
    // 移除填充字符和非 Base32 字符，并转换为大写
    base32Str = base32Str.replace(/=+$/, '').toUpperCase();

    let bits = 0;
    let value = 0;
    // 预估输出 Buffer 的最大长度，稍后会裁剪
    const output = new Uint8Array(Math.ceil(base32Str.length * 5 / 8));
    let outputIndex = 0;

    for (let i = 0; i < base32Str.length; i++) {
        const char = base32Str[i];
        const val = lookup[char];

        if (typeof val === 'undefined') {
            // 如果遇到无效字符（非A-Z, 2-7），选择跳过。
            // 如果需要严格验证，可以抛出错误：throw new Error("Invalid Base32 character: " + char);
            continue;
        }

        value = (value << 5) | val;
        bits += 5;

        if (bits >= 8) {
            output[outputIndex++] = (value >>> (bits - 8)) & 255;
            bits -= 8;
        }
    }

    // 裁剪 Uint8Array 到实际数据长度
    const resultUint8Array = output.subarray(0, outputIndex);
    // 返回 Node.js Buffer
    return Buffer.from(resultUint8Array);
}

// 使用命名导出
export {
    encode,
    decode
};

//磁力链可以是 base32的
//console.log( decode('AD2KAVOHEBC4DM2VGEV4UZ5F256LN3DQ').toString('hex').toUpperCase() )