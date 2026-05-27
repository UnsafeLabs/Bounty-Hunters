   public function upload(Request $request)
   {
       $request->validate([
           'file' => 'required|file|max:10240', // 10MB limit
       ]);
       $file = $request->file('file');
       $checksum = hash_file('sha256', $file->path());
       $existingFile = \App\Models\File::where('checksum_sha256', $checksum)->first();
       if ($existingFile) {
           return response()->json(['error' => 'File with this checksum already exists'], 409);
       }
       $fileData = [
           'original_name' => $file->getClientOriginalName(),
           'stored_path' => $file->path(),
           'mime_type' => $file->getMimeType(),
           'size_bytes' => $file->getSize(),
           'checksum_sha256' => $checksum,
           'uploaded_by' => auth()->user()->id,
       ];
       $fileRecord = new \App\Models\File();
       $fileRecord->fill($fileData);
       $fileRecord->save();
       return response()->json(['message' => 'File uploaded successfully'], 200);
   }
   public function download($id)
   {
       $file = \App\Models\File::find($id);
       if (!$file) {
           return response()->json(['error' => 'File not found'], 404);
       }
       $path = $file->stored_path;
       $mimeType = $file->getMimeType();
       $headers = [
           'Content-Type' => $mimeType,
           'Content-Disposition' => 'attachment; filename="' . $file->original_name . '"'
       ];
       return response()->file($path, $headers);
   }
   public function delete($id)
   {
       $file = \App\Models\File::find($id);
       if (!$file) {
           return response()->json(['error' => 'File not found'], 404);
       }
       $file->delete();
       return response()->json(['message' => 'File deleted'], 200);
   }
   public function list()
   {
       $files = \App\Models\File::paginate(20);
       return response()->json($files);
   }