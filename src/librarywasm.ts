export function library(): string {
    return `
#if WASM

  // These will be filled in by the WebAssembly code generator
  unsafe var currentHeapPointer: *byte = null;
  unsafe var originalHeapPointer: *byte = null;

  extern unsafe function malloc(sizeOf: uint32): *byte {
    // Align all allocations to 8 bytes
    var offset = ((currentHeapPointer + 7) & ~7) as *byte;
    sizeOf = (sizeOf + 7) & ~7;

    // Use a simple bump allocator for now
    var limit = offset + sizeOf;
    currentHeapPointer = limit;

    // Make sure the memory starts off at zero
    var ptr = offset;
    while (ptr < limit) {
      *(ptr as *int32) = 0;
      ptr = ptr + 4;
    }

    return offset;
  }

  unsafe function memcpy(target: *byte, source: *byte, length: uint32): void {
    // No-op if either of the inputs are null
    if (source == null || target == null) {
      return;
    }

    // Optimized aligned copy
    if (length >= 16 && (source) % 4 == (target) % 4) {
      // Pick off the beginning
      while ((target) % 4 != 0) {
        *target = *source;
        target = target + 1;
        source = source + 1;
        length = length - 1;
      }

      // Pick off the end
      while (length % 4 != 0) {
        length = length - 1;
        *(target + length) = *(source + length);
      }

      // Zip over the middle
      var end = target + length;
      while (target < end) {
        *(target as *int32) = *(source as *int32);
        target = target + 4;
        source = source + 4;
      }
    }

    // Slow unaligned copy
    else {
      var end = target + length;
      while (target < end) {
        *target = *source;
        target = target + 1;
        source = source + 1;
      }
    }
  }

  unsafe function memcmp(a: *byte, b: *byte, length: uint32): int32 {
    // No-op if either of the inputs are null
    if (a == null || b == null) {
      return 0;
    }

    // Return the first non-zero difference
    while (length > 0) {
      var delta = *a - *b;
      if (delta != 0) {
        return delta;
      }
      a = a + 1;
      b = b + 1;
      length = length - 1;
    }

    // Both inputs are identical
    return 0;
  }

#elif C

  declare unsafe function malloc(sizeOf: uint32): *byte;
  declare unsafe function memcpy(target: *byte, source: *byte, length: uint32): void;
  declare unsafe function memcmp(a: *byte, b: *byte, length: uint32): int32;

#endif

#if WASM || C

  declare class boolean {
    toString(): string {
      return this ? "true" : "false";
    }
  }

  declare class sbyte {
    toString(): string {
      return (this).toString();
    }
  }

  declare class byte {
    toString(): string {
      return (this).toString();
    }
  }

  declare class short {
    toString(): string {
      return (this).toString();
    }
  }

  declare class ushort {
    toString(): string {
      return (this).toString();
    }
  }

  declare class int32 {
    toString(): string {
      // Special-case this to keep the rest of the code simple
      if (this == -2147483648) {
        return "-2147483648";
      }

      // Treat this like an unsigned integer prefixed by '-' if it's negative
      return internalIntToString((this < 0 ? -this : this), this < 0);
    }
  }

  declare class uint32 {
    toString(): string {
      return internalIntToString(this, false);
    }
  }

    declare class float32 {
        toString(): string {
            return "C Float to string not implemented";
        }
    }
    
    /*function internalFloatToString(value: float32): string {
        // Extract integer part
        var ipart:int32 = value;
    
        // Extract floating part
        var fpart:float32 = value - (ipart as float32);
    
        // convert integer part to string
        var intStr:string = internalIntToString((ipart < 0 ? -ipart : ipart), ipart < 0);
    
        // check for display option after point
        // Get the value of fraction part upto given no.
        // of points after dot. The third parameter is needed
        // to handle cases like 233.007
        fpart = fpart * Math.pow(10, 10);
    
        return intStr + "." + internalIntToString((fpart), false);
    }*/

  function internalIntToString(value: uint32, sign: boolean): string {
    // Avoid allocation for common cases
    if (value == 0) return "0";
    if (value == 1) return sign ? "-1" : "1";

    unsafe {
      // Determine how many digits we need
      var length = ((sign ? 1 : 0) + (
        value >= 100000000 ?
          value >= 1000000000 ? 10 : 9 :
        value >= 10000 ?
          value >= 1000000 ?
            value >= 10000000 ? 8 : 7 :
            value >= 100000 ? 6 : 5 :
          value >= 100 ?
            value >= 1000 ? 4 : 3 :
            value >= 10 ? 2 : 1));

      var ptr = string_new(length) as *byte;
      var end = ptr + 4 + length * 2;

      if (sign) {
        *((ptr + 4) as *ushort) = '-';
      }

      while (value != 0) {
        end = end + -2;
        *(end as *ushort) = (value % 10 + '0') as ushort;
        value = value / 10;
      }

      return ptr as string;
    }
  }

  function string_new(length: uint32): string {
    unsafe {
      var ptr = malloc(4 + length * 2);
      *(ptr as *uint32) = length;
      return ptr as string;
    }
  }

  declare class string {
    charAt(index: int32): string {
      return this.slice(index, index + 1);
    }

    charCodeAt(index: int32): ushort {
      return this[index];
    }

    get length(): int32 {
      unsafe {
        return *(this as *int32);
      }
    }

    operator [] (index: int32): ushort {
      if (index < this.length) {
        unsafe {
          return *((this as *byte + 4 + index * 2) as *ushort);
        }
      }
      return 0;
    }

    operator == (other: string): boolean {
      unsafe {
        if (this as *byte == other as *byte) return true;
        if (this as *byte == null || other as *byte == null) return false;
        var length = this.length;
        if (length != other.length) return false;
        return memcmp(this as *byte + 4, other as *byte + 4, length * 2) == 0;
      }
    }

    slice(start: int32, end: int32): string {
      var length = this.length;

      if (start < 0) start = start + length;
      if (end < 0) end = end + length;

      if (start < 0) start = 0;
      else if (start > length) start = length;

      if (end < start) end = start;
      else if (end > length) end = length;

      unsafe {
        var range = (end - start);
        var ptr = string_new(range);
        memcpy(ptr as *byte + 4, this as *byte + 4 + start * 2, range * 2);
        return ptr;
      }
    }

    startsWith(text: string): boolean {
      var textLength = text.length;
      if (this.length < textLength) return false;
      unsafe {
        return memcmp(this as *byte + 4, text as *byte + 4, textLength * 2) == 0;
      }
    }

    endsWith(text: string): boolean {
      var thisLength = this.length;
      var textLength = text.length;
      if (thisLength < textLength) return false;
      unsafe {
        return memcmp(this as *byte + 4 + (thisLength - textLength) * 2, text as *byte + 4, textLength * 2) == 0;
      }
    }

    indexOf(text: string): int32 {
      var thisLength = this.length;
      var textLength = text.length;
      if (thisLength >= textLength) {
        var i = 0;
        while (i < thisLength - textLength) {
          unsafe {
            if (memcmp(this as *byte + 4 + i * 2, text as *byte + 4, textLength * 2) == 0) {
              return i;
            }
          }
          i = i + 1;
        }
      }
      return -1;
    }

    lastIndexOf(text: string): int32 {
      var thisLength = this.length;
      var textLength = text.length;
      if (thisLength >= textLength) {
        var i = thisLength - textLength;
        while (i >= 0) {
          unsafe {
            if (memcmp(this as *byte + 4 + i * 2, text as *byte + 4, textLength * 2) == 0) {
              return i;
            }
          }
          i = i - 1;
        }
      }
      return -1;
    }
  }

#else

  declare class boolean {
    toString(): string;
  }

  declare class sbyte {
    toString(): string;
  }

  declare class byte {
    toString(): string;
  }

  declare class short {
    toString(): string;
  }

  declare class ushort {
    toString(): string;
  }

  declare class int32 {
    toString(): string;
  }

  declare class uint32 {
    toString(): string;
  }

  declare class float32 {
    toString(): string;
  }

  declare class string {
    charAt(index: int32): string;
    charCodeAt(index: int32): ushort;
    get length(): int32;
    indexOf(text: string): int32;
    lastIndexOf(text: string): int32;
    operator == (other: string): boolean;
    operator [] (index: int32): ushort { return this.charCodeAt(index); }
    slice(start: int32, end: int32): string;

    #if JS
      startsWith(text: string): boolean { return this.slice(0, text.length) == text; }
      endsWith(text: string): boolean { return this.slice(-text.length, this.length) == text; }
    #else
      startsWith(text: string): boolean;
      endsWith(text: string): boolean;
    #endif
  }

#endif

#if C

  extern unsafe function cstring_to_utf16(utf8: *byte): string {
    if (utf8 == null) {
      return null;
    }

    var utf16_length: uint32 = 0;
    var a: byte, b: byte, c: byte, d: byte;

    // Measure text
    var i: uint32 = 0;
    while ((a = *(utf8 + i)) != '\\0') {
      i = i + 1;
      var codePoint: uint32;

      // Decode UTF-8
      if ((b = *(utf8 + i)) != '\\0' && a >= 0xC0) {
        i = i + 1;
        if ((c = *(utf8 + i)) != '\\0' && a >= 0xE0) {
          i = i + 1;
          if ((d = *(utf8 + i)) != '\\0' && a >= 0xF0) {
            i = i + 1;
            codePoint = ((a & 0x07) << 18) | ((b & 0x3F) << 12) | ((c & 0x3F) << 6) | (d & 0x3F);
          } else {
            codePoint = ((a & 0x0F) << 12) | ((b & 0x3F) << 6) | (c & 0x3F);
          }
        } else {
          codePoint = ((a & 0x1F) << 6) | (b & 0x3F);
        }
      } else {
        codePoint = a;
      }

      // Encode UTF-16
      utf16_length = utf16_length + (codePoint < 0x10000 ? 1 : 2);
    }

    var output = string_new(utf16_length);
    var utf16 = output as *ushort + 2;

    // Convert text
    i = 0;
    while ((a = *(utf8 + i)) != '\\0') {
      i = i + 1;
      var codePoint: uint32;

      // Decode UTF-8
      if ((b = *(utf8 + i)) != '\\0' && a >= 0xC0) {
        i = i + 1;
        if ((c = *(utf8 + i)) != '\\0' && a >= 0xE0) {
          i = i + 1;
          if ((d = *(utf8 + i)) != '\\0' && a >= 0xF0) {
            i = i + 1;
            codePoint = ((a & 0x07) << 18) | ((b & 0x3F) << 12) | ((c & 0x3F) << 6) | (d & 0x3F);
          } else {
            codePoint = ((a & 0x0F) << 12) | ((b & 0x3F) << 6) | (c & 0x3F);
          }
        } else {
          codePoint = ((a & 0x1F) << 6) | (b & 0x3F);
        }
      } else {
        codePoint = a;
      }

      // Encode UTF-16
      if (codePoint < 0x10000) {
        *utf16 = codePoint as ushort;
      } else {
        *utf16 = ((codePoint >> 10) + (0xD800 - (0x10000 >> 10))) as ushort;
        utf16 = utf16 + 1;
        *utf16 = ((codePoint & 0x3FF) + 0xDC00) as ushort;
      }
      utf16 = utf16 + 1;
    }

    return output;
  }

  extern unsafe function utf16_to_cstring(input: string): *byte {
    if (input as *uint32 == null) {
      return null;
    }

    var utf16_length = *(input as *uint32);
    var utf8_length: uint32 = 0;
    var utf16 = input as *ushort + 2;

    // Measure text
    var i: uint32 = 0;
    while (i < utf16_length) {
      var codePoint: uint32;

      // Decode UTF-16
      var a = *(utf16 + i);
      i = i + 1;
      if (i < utf16_length && a >= 0xD800 && a <= 0xDBFF) {
        var b = *(utf16 + i);
        i = i + 1;
        codePoint = (a << 10) + b + (0x10000 - (0xD800 << 10) - 0xDC00);
      } else {
        codePoint = a;
      }

      // Encode UTF-8
      utf8_length = utf8_length + (
        codePoint < 0x80 ? 1 :
        codePoint < 0x800 ? 2 :
        codePoint < 0x10000 ? 3 :
        4);
    }

    var utf8 = malloc(utf8_length + 1);
    var next = utf8;

    // Convert text
    i = 0;
    while (i < utf16_length) {
      var codePoint: uint32;

      // Decode UTF-16
      var a = *(utf16 + i);
      i = i + 1;
      if (i < utf16_length && a >= 0xD800 && a <= 0xDBFF) {
        var b = *(utf16 + i);
        i = i + 1;
        codePoint = (a << 10) + b + (0x10000 - (0xD800 << 10) - 0xDC00);
      } else {
        codePoint = a;
      }

      // Encode UTF-8
      if (codePoint < 0x80) {
        *next = codePoint;
      } else {
        if (codePoint < 0x800) {
          *next = (((codePoint >> 6) & 0x1F) | 0xC0);
        } else {
          if (codePoint < 0x10000) {
            *next = (((codePoint >> 12) & 0x0F) | 0xE0);
          } else {
            *next = (((codePoint >> 18) & 0x07) | 0xF0);
            next = next + 1;
            *next = (((codePoint >> 12) & 0x3F) | 0x80);
          }
          next = next + 1;
          *next = (((codePoint >> 6) & 0x3F) | 0x80);
        }
        next = next + 1;
        *next = ((codePoint & 0x3F) | 0x80);
      }
      next = next + 1;
    }

    // C strings are null-terminated
    *next = '\\0';

    return utf8;
  }

#endif

#if TURBO_JS

    function turbo_js():int32 {
        return 1;
    }

#endif
`;
}