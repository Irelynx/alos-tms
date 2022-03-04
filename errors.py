class NoChunksRequired(Exception):
    baseText = "Amount of chunks is less than 1"
    def __init__(self, *args):
        self.message = args[0] if args else None

    def __str__(self):
        return self.message if self.message else self.baseText