import requests
from bs4 import BeautifulSoup
import json

# URL of the page containing the list of icons
url = "https://github.com/vscode-icons/vscode-icons/wiki/ListOfFiles"
# url = "https://github.com/vscode-icons/vscode-icons/wiki/ListOfFolders"

# Make a request to the URL and get the page content
response = requests.get(url)
soup = BeautifulSoup(response.text, 'html.parser')

# Find the table with the list of icons
table = soup.find('table')

# Extract the data from the table
icon_mapping = {}
for row in table.find_all('tr')[1:]:  # Skip the header row
    columns = row.find_all('td')
    if len(columns) >= 2:  # Check if there are enough columns
        icon_name = columns[0].text.strip()
        values = columns[1].contents  # Get contents to handle mixed content

        if icon_name not in icon_mapping:
            icon_mapping[icon_name] = {"extensions": [], "filenames": [], "languageIds": []}

        for value in values:
            if isinstance(value, str):
                # Split the text by comma and add to extensions
                items = value.split(', ')
                icon_mapping[icon_name]["extensions"].extend(items)
            elif value.name == 'b':  # Handle filenames in bold
                icon_mapping[icon_name]["filenames"].append(value.text.strip())
            elif value.name == 'code':  # Handle language IDs in code blocks
                icon_mapping[icon_name]["languageIds"].append(value.text.strip())

# Remove duplicates
for icon_name, data in icon_mapping.items():
    data["extensions"] = list(set(data["extensions"]))
    data["filenames"] = list(set(data["filenames"]))
    data["languageIds"] = list(set(data["languageIds"]))

# Save the mapping to a JSON file
output_file = "resources/icons_mapping.json"
# output_file = "resources/media/folders_icons_mapping.json"
with open(output_file, "w") as json_file:
    json.dump(icon_mapping, json_file, indent=4)

print(f"Icon mapping has been saved to {output_file}")
