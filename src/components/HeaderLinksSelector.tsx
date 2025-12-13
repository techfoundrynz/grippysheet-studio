import { Info } from 'lucide-react'
import { Dropdown } from './ui/Dropdown'
import { SiDiscord, SiGithub } from '@icons-pack/react-simple-icons';

export function HeaderLinksSelector() {
  const handleLinkSelect = (url: string) => {
    window.open(url, '_blank');
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Dropdown
        options={[
          {
            value: "https://github.com/techfoundrynz/pubgrip-generator",
            tooltip: `Printgrip Maker GitHub repository`,
            icon: <SiGithub className="h-4 w-4" />,
            label: (
              <div className="flex items-center justify-between w-full">
                <div className="flex-1 truncate">
                  <span className="mr-2">View source code</span>
                </div>
              </div>
            )
          }
        ]}
        value=""
        onChange={(value) => handleLinkSelect(value as string)}
        icon={<Info className="h-4 w-4" />}
        label="Links"
        width="fixed"
        dropdownWidth="auto"
        variant="ghost"
        />
      </div>
    </div>
  );
}