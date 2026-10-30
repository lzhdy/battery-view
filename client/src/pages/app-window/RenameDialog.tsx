import React from 'react';

import { Button } from '@client/src/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@client/src/components/ui/dialog';
import { Input } from '@client/src/components/ui/input';
import type { BatteryDevice } from '@client/src/utils/battery/types';

interface RenameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  device: BatteryDevice | null;
  currentName: string;
  onRename: (name: string) => void;
}

const RenameDialog: React.FC<RenameDialogProps> = ({
  open,
  onOpenChange,
  device,
  currentName,
  onRename,
}) => {
  const [name, setName] = React.useState<string>(currentName);

  React.useEffect(() => {
    if (open) setName(currentName);
  }, [open, currentName]);

  const submit = () => {
    const trimmed = name.trim();
    if (device === null || trimmed === '') return;
    onRename(trimmed);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[400px] max-w-[90vw]">
        <DialogHeader>
          <DialogTitle>重命名设备</DialogTitle>
          <DialogDescription>为「{device?.name ?? ''}」设置一个新名字</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event: React.FormEvent) => {
            event.preventDefault();
            submit();
          }}
        >
          <Input
            value={name}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => setName(event.target.value)}
            placeholder="设备名称"
            aria-label="设备名称"
            maxLength={24}
          />
          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={name.trim() === ''}>
              保存
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default RenameDialog;
