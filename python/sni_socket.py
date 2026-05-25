import socket
import struct
import ssl

EXT_SNI = 0x0000
EXT_EXTENDED_MASTER_SECRET = 0x0017
EXT_SIGNATURE_ALGORITHMS = 0x000D

class TLSExtension:
    def __init__(self):
        self.server_name = None

class TLSHandshake:
    def __init__(self):
        self.server_name = None

def parse_extensions(data, ext, handshake):
    offset = 0
    while offset + 4 <= len(data):
        ext_type = struct.unpack('>H', data[offset:offset+2])[0]
        ext_len = struct.unpack('>H', data[offset+2:offset+4])[0]
        ext_data = data[offset+4:offset+4+ext_len]
        
        if ext_type == EXT_SNI:
            if len(ext_data) >= 3:
                sni_list_len = struct.unpack('>H', ext_data[0:2])[0]
                if len(ext_data) >= 5:
                    name_type = ext_data[2]
                    if name_type == 0x00:
                        name_len = struct.unpack('>H', ext_data[3:5])[0]
                        if len(ext_data) >= 5 + name_len:
                            hostname = ext_data[5:5+name_len].decode('utf-8')
                            ext.server_name = hostname
                            handshake.server_name = hostname
        elif ext_type == EXT_EXTENDED_MASTER_SECRET:
            pass
        elif ext_type == EXT_SIGNATURE_ALGORITHMS:
            pass
        
        offset += 4 + ext_len

def connect_with_sni(hostname, port=443):
    handshake = TLSHandshake()
    ext = TLSExtension()
    return handshake, ext