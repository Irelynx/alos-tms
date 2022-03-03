from time import sleep
import cv2
import numpy
import math

# image = cv2.imread(filename)

class Point:
    def __init__(self, lat, lon):
        self.lat = lat
        self.lon = lon

class Rect:
    def __init__(self, lat1, lon1, lat2, lon2):
        self.lat1 = lat1
        self.lon1 = lon1
        self.lat2 = lat2
        self.lon2 = lon2

class Worker:
    dataset_path = "./png_fullsize/"
    def __init__(self): pass
    
    def toNSEWString(self, lat, lon) -> str:
        NS = "S" if lat < 0 else "N"
        EW = "W" if lon < 0 else "E"

        lat = math.floor(lat)
        lon = math.floor(lon)

        RLAT = -lat if NS == 'S' else lat
        RLON = -lon if EW == 'W' else lon

        NSEWSTRING = f"{NS}{('000'+str(RLAT))[-3:]}{EW}{('000'+str(RLON))[-3:]}"

        return NSEWSTRING
        
    def fromNSEWString(self, string: str) -> Rect:
        NS = string[0:1]
        EW = string[4:5]
        rlat = int(string[1:4]) * (-1 if NS == "S" else 1)
        rlon = int(string[5:8]) * (-1 if EW == "W" else 1)

        return Rect(
            lat1=rlat,
            lon1=rlon,
            lat2=rlat + 1,
            lon2=rlon + 1,
        )

    def getMedianPoint(self, p1: Point, p2: Point):
        return Point(p1.lat + (p2.lat - p1.lat) * 0.5, p1.lon + (p2.lon - p1.lon) * 0.5)

    def getFileName(self, point: Point):
        nsew = self.toNSEWString(point.lat, point.lon)
        return f"{self.dataset_path}{nsew}.png"
    
    def openImage(self, filename: str) -> numpy.ndarray: return cv2.imread(filename)

    def getFiles(self, point1: Point, point2: Point) -> list[numpy.ndarray]:
        dlat = abs(point1.lat - point2.lat)
        dlon = abs(point1.lon - point2.lon)
        number_of_chunks = (math.floor(dlat) + 1) * (math.floor(abs(dlon)) + 1)
        if number_of_chunks == 1:
            image = self.openImage(self.getFileName(point1))
            print(self.toNSEWString(lat=point1.lat, lon=point1.lon))
            nsew = self.fromNSEWString(self.toNSEWString(lat=point1.lat, lon=point1.lon))
            height = len(image)
            width = len(image[0])

            x1 = math.floor((point1.lat - nsew.lat1) * width)
            y1 = math.floor((point1.lon - nsew.lon1) * height)
            x2 = math.ceil((point2.lat - nsew.lat1) * width)
            y2 = math.ceil((point2.lon - nsew.lon1) * height)
            
            print(x1, x2, y1, y2)
            slice = self.getImageSlice(
                image=image,
                x1=x1, y1=y1,
                x2=x2, y2=y2,
            )
            return slice
            # TODO
        else:
            raise Exception("Unimplemented") # TODO: own exceptions
        
        # if number_of_chunks != 1: N images

        
    def getImageSlice(self, x1, x2, y1, y2, image: numpy.ndarray) -> numpy.ndarray:
        return image[y1:y2, x1:x2]


filename = "./png_fullsize/S026W049.png"

wk = Worker()
img = wk.getFiles(Point(-25.7, -48.5), Point(-25.3, -48.1))
# new_img = img[0:550, 0:200] # [y1:y2, x1:x2]
# #print(new_img)



cv2.imshow("test", img)



cv2.waitKey(0)